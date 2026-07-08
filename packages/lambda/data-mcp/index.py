"""Data MCP Lambda handler for AgentCore Gateway.

Exposes three tools for querying structured datasets (Parquet) in a project:
  - search_datasets(project_id, query): hybrid search the per-project catalog
  - describe_dataset(project_id, dataset_uri): return the reference document (.txt)
  - run_sql(project_id, dataset_uri(s), query): read-only DuckDB query over Parquet

Parquet is read via pyarrow + s3fs and registered into DuckDB. All access is
scoped to the given project_id; run_sql validates every dataset_uri against the
project's DATASET# items before loading.
"""

import datetime
import decimal
import json
import os
import re
from urllib.parse import urlparse

import boto3
import duckdb
import pyarrow.parquet as pq
import s3fs
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ["BACKEND_TABLE_NAME"]
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
LANCEDB_FUNCTION_ARN = os.environ.get("LANCEDB_FUNCTION_ARN", "idp-v2-lance-service")

# Number of datasets search_datasets returns to the LLM.
SEARCH_DATASETS_LIMIT = int(os.environ.get("SEARCH_DATASETS_LIMIT", "10"))

# Result guardrail: cap rows returned to the LLM regardless of dataset size.
MAX_RESULT_ROWS = int(os.environ.get("MAX_RESULT_ROWS", "200"))

# Memory guardrail: with method 2 (pyarrow reads the whole Parquet into memory),
# reject queries whose combined row count would risk OOM. ~100k rows/dataset is
# well within a 2 GB Lambda; this only blocks runaway multi-dataset loads.
MAX_TOTAL_ROWS = int(os.environ.get("MAX_TOTAL_ROWS", "2000000"))


def _to_jsonable(value):
    """Convert DuckDB values to JSON-serializable primitives."""
    if isinstance(value, (datetime.date, datetime.datetime, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


_ddb_table = boto3.resource("dynamodb", region_name=AWS_REGION).Table(TABLE_NAME)
_s3 = boto3.client("s3", region_name=AWS_REGION)
_lambda = boto3.client("lambda", region_name=AWS_REGION)

# Reused across warm invocations. Parquet is read via pyarrow + s3fs and
# registered into DuckDB, avoiding the httpfs extension (which fails to
# download on Lambda's arm64 platform for the pinned DuckDB version).
_con: duckdb.DuckDBPyConnection | None = None
_fs: s3fs.S3FileSystem | None = None
# Loaded Arrow tables kept alive so DuckDB's registration stays valid. Keyed by
# dataset_uri; reused across invocations so warm calls skip the S3 read. The
# cached S3 ETag is stored alongside so a re-converted/replaced Parquet (same
# URI, new content) is detected and re-read instead of serving stale data.
_tables: dict[str, object] = {}
_etags: dict[str, str] = {}
# Table names currently registered on the connection (so we can register several
# datasets at once for JOINs, and clear stale ones between calls).
_registered_names: set[str] = set()


def _current_etag(dataset_uri: str) -> str | None:
    """Return the S3 ETag for a dataset, or None if it can't be fetched."""
    parsed = urlparse(dataset_uri)
    try:
        head = _s3.head_object(Bucket=parsed.netloc, Key=parsed.path.lstrip("/"))
        return head.get("ETag")
    except Exception:  # noqa: BLE001 - fall back to caching without invalidation
        return None


def _get_fs() -> s3fs.S3FileSystem:
    global _fs
    if _fs is None:
        _fs = s3fs.S3FileSystem()
    return _fs


def _get_con() -> duckdb.DuckDBPyConnection:
    global _con
    if _con is None:
        _con = duckdb.connect()
    return _con


def _dataset_id_from_uri(dataset_uri: str) -> str:
    """Extract the dataset_id (the Parquet filename without extension) from a URI."""
    return dataset_uri.rsplit("/", 1)[-1].rsplit(".", 1)[0]


def table_name_for(dataset_uri: str) -> str:
    """Derive a safe SQL identifier from a dataset URI.

    The dataset_id is document_id-based (e.g. 'e4c9-..-72bc' or '..__0'), which
    is not a valid bare SQL identifier (hyphens, may start with a digit). Convert
    it deterministically: 't_' + hex-only id, with '__N' sheet suffix kept as
    '_sN'. Both this Lambda and the LLM use this same name, so they always agree.
    Example: 'e4c95c84-f25f-...-72bc'      -> 't_e4c95c84f25f...72bc'
             'e4c95c84-...__0'             -> 't_e4c95c84...' + '_s0'
    """
    dataset_id = _dataset_id_from_uri(dataset_uri)
    sheet_suffix = ""
    if "__" in dataset_id:
        base, _, idx = dataset_id.rpartition("__")
        if idx.isdigit():
            dataset_id = base
            sheet_suffix = f"_s{idx}"
    sanitized = re.sub(r"[^0-9a-zA-Z]", "", dataset_id)
    return f"t_{sanitized}{sheet_suffix}"


def _register_datasets(dataset_uris: list[str]) -> dict[str, str]:
    """Load each Parquet from S3 (cached) and register it under its derived name.

    Registrations from a previous call are dropped first so table names never
    leak across invocations. Returns a {dataset_uri: table_name} map. When a
    single dataset is registered it is ALSO aliased as 'data' for backward
    compatibility with existing prompts/reference docs that use `FROM data`.
    """
    global _registered_names
    con = _get_con()

    for name in _registered_names:
        con.unregister(name)
    _registered_names = set()

    uri_to_name: dict[str, str] = {}
    for dataset_uri in dataset_uris:
        # Re-read when the Parquet is uncached or its S3 ETag changed (data was
        # re-converted/replaced under the same URI).
        etag = _current_etag(dataset_uri)
        if dataset_uri not in _tables or (etag is not None and _etags.get(dataset_uri) != etag):
            _tables[dataset_uri] = pq.read_table(dataset_uri, filesystem=_get_fs())
            _etags[dataset_uri] = etag
        name = table_name_for(dataset_uri)
        con.register(name, _tables[dataset_uri])
        _registered_names.add(name)
        uri_to_name[dataset_uri] = name

    if len(dataset_uris) == 1:
        con.register("data", _tables[dataset_uris[0]])
        _registered_names.add("data")

    return uri_to_name


def _query_datasets(project_id: str) -> list[dict]:
    """Return all DATASET# items for a project."""
    result = _ddb_table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJ#{project_id}")
        & Key("SK").begins_with("DATASET#"),
    )
    return result.get("Items", [])


def search_datasets(event: dict) -> dict:
    """Find datasets relevant to a query via hybrid search over the per-project
    catalog (LanceDB). Returns the top matches with their table_name for run_sql.

    Replaces listing all datasets: with many datasets, returning the full list
    wastes tokens and hurts selection. The catalog is populated by dataset-process
    at conversion time.
    """
    project_id = event["project_id"]
    query = event.get("query", "")

    resp = _lambda.invoke(
        FunctionName=LANCEDB_FUNCTION_ARN,
        InvocationType="RequestResponse",
        Payload=json.dumps(
            {
                "action": "search_datasets",
                "params": {
                    "project_id": project_id,
                    "query": query,
                    "limit": SEARCH_DATASETS_LIMIT,
                },
            }
        ),
    )
    payload = resp["Payload"].read().decode("utf-8")
    if "FunctionError" in resp:
        return {"error": f"Dataset search failed: {payload}"}

    result = json.loads(payload)
    datasets = []
    for r in result.get("results", []):
        dataset_uri = r.get("dataset_s3_uri")
        datasets.append(
            {
                "dataset_uri": dataset_uri,
                "table_name": table_name_for(dataset_uri) if dataset_uri else None,
                "name": r.get("name"),
                "description": r.get("description", ""),
            }
        )
    return {"datasets": datasets}


def describe_dataset(event: dict) -> dict:
    project_id = event["project_id"]
    dataset_uri = event["dataset_uri"]

    # Find the dataset item to distinguish "unknown dataset" from "no reference doc".
    data = None
    for item in _query_datasets(project_id):
        if item.get("data", {}).get("dataset_s3_uri") == dataset_uri:
            data = item["data"]
            break
    if data is None:
        return {
            "error": (
                f"Unknown dataset_uri for this project: {dataset_uri}. "
                "Call search_datasets first."
            )
        }

    # table_name is what the LLM must use in FROM. For a single-dataset query it
    # can also use 'data'; for a JOIN across datasets it must use each table_name.
    table_name = table_name_for(dataset_uri)

    reference_uri = data.get("reference_s3_uri")
    if reference_uri:
        try:
            parsed = urlparse(reference_uri)
            obj = _s3.get_object(Bucket=parsed.netloc, Key=parsed.path.lstrip("/"))
            reference = obj["Body"].read().decode("utf-8")
            return {"table_name": table_name, "reference": reference}
        except Exception:  # noqa: BLE001 - fall back to metadata below
            pass

    # No reference doc (generation failed/skipped): return a minimal description
    # from the dataset metadata so Text2SQL can still work.
    return {"table_name": table_name, "reference": _fallback_reference(data)}


def _fallback_reference(data: dict) -> str:
    name = data.get("name", "dataset")
    columns = data.get("columns") or []
    row_count = data.get("row_count")
    lines = [
        f"# Dataset: {name}",
        "",
        "Table name to use in SQL: `data`",
    ]
    if row_count is not None:
        lines.append(f"Row count: {row_count}")
    if columns:
        lines.append("")
        lines.append("## Columns")
        for c in columns:
            lines.append(f"- {c}")
    lines.append("")
    lines.append(
        "Note: no detailed reference document is available for this dataset. "
        "Use get column names above; quote names with spaces/special characters "
        'in SQL (e.g. "Product hierarchy").'
    )
    return "\n".join(lines)


def run_sql(event: dict) -> dict:
    project_id = event["project_id"]
    query = event["query"]

    # Accept a single dataset_uri (backward compatible) or a list for JOINs.
    dataset_uris = event.get("dataset_uris")
    if not dataset_uris:
        single = event.get("dataset_uri")
        dataset_uris = [single] if single else []
    if not dataset_uris:
        return {"error": "Provide dataset_uri or dataset_uris (from search_datasets)."}
    # De-duplicate while preserving order (same dataset referenced twice is fine).
    seen: set[str] = set()
    dataset_uris = [u for u in dataset_uris if not (u in seen or seen.add(u))]

    # Every dataset must belong to the project. This is the isolation boundary:
    # the LLM can only query datasets it discovered via list_datasets, never an
    # arbitrary S3 path. Also gather row counts for the memory guard.
    items = {
        item["data"]["dataset_s3_uri"]: item["data"]
        for item in _query_datasets(project_id)
        if item.get("data", {}).get("dataset_s3_uri")
    }
    total_rows = 0
    for uri in dataset_uris:
        if uri not in items:
            return {
                "error": (
                    f"Unknown dataset_uri for this project: {uri}. "
                    "Call search_datasets first."
                )
            }
        total_rows += items[uri].get("row_count") or 0

    if total_rows > MAX_TOTAL_ROWS:
        return {
            "error": (
                f"Datasets too large to load in memory ({total_rows} rows > "
                f"{MAX_TOTAL_ROWS}). Query fewer/smaller datasets."
            )
        }

    if not _is_read_only(query):
        return {"error": "Only read-only SELECT/WITH queries are allowed."}

    con = _get_con()

    # Load each Parquet from S3 and expose it under its derived table name (and
    # 'data' when there is exactly one dataset).
    try:
        _register_datasets(dataset_uris)
    except Exception as e:  # noqa: BLE001 - surface any S3/Parquet read error
        return {"error": f"Failed to load dataset: {e}"}

    try:
        cursor = con.execute(query)
        columns = [d[0] for d in cursor.description]
        # Fetch one extra row to detect truncation without a second query.
        fetched = cursor.fetchmany(MAX_RESULT_ROWS + 1)
    except duckdb.Error as e:
        return {"error": f"Query failed: {e}"}

    truncated = len(fetched) > MAX_RESULT_ROWS
    rows = [
        {col: _to_jsonable(val) for col, val in zip(columns, row)}
        for row in fetched[:MAX_RESULT_ROWS]
    ]

    result: dict = {"rows": rows, "row_count": len(rows)}
    if truncated:
        result["truncated"] = True
        result["note"] = (
            f"Result truncated to {MAX_RESULT_ROWS} rows. "
            "Add aggregation or a tighter WHERE/LIMIT for complete results."
        )
    return result


_READ_ONLY_RE = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)
_FORBIDDEN_RE = re.compile(
    r"\b(insert|update|delete|drop|create|alter|attach|copy|install|load|"
    r"pragma|set|export|import|call)\b",
    re.IGNORECASE,
)
# Match single- or double-quoted string literals so forbidden keywords inside
# them (e.g. WHERE name = 'update me') are not treated as statements.
_STRING_LITERAL_RE = re.compile(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"")


def _is_read_only(query: str) -> bool:
    """Allow only single SELECT/WITH statements; reject DDL/DML and multi-statements."""
    stripped = query.strip().rstrip(";")
    if not _READ_ONLY_RE.match(stripped):
        return False
    # Strip string literals before checking for statement separators and
    # forbidden keywords, so quoted content cannot cause false negatives.
    without_strings = _STRING_LITERAL_RE.sub("''", stripped)
    if ";" in without_strings:
        return False
    if _FORBIDDEN_RE.search(without_strings):
        return False
    return True


_TOOLS = {
    "search_datasets": search_datasets,
    "describe_dataset": describe_dataset,
    "run_sql": run_sql,
}


def handler(event: dict, context) -> dict:
    """AgentCore Gateway invokes with the tool name in clientContext.custom."""
    tool_name = ""
    client_context = getattr(context, "client_context", None)
    if client_context is not None and getattr(client_context, "custom", None):
        tool_name = client_context.custom.get("bedrockAgentCoreToolName", "")

    action = tool_name.split("___")[-1] if "___" in tool_name else tool_name

    fn = _TOOLS.get(action)
    if fn is None:
        return {"error": f"Unknown tool: {tool_name}"}
    return fn(event)
