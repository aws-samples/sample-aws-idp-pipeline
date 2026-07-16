import re

import duckdb
from pydantic import BaseModel

from app.config import get_config


class Session(BaseModel):
    session_id: str
    session_type: str
    created_at: str
    updated_at: str
    session_name: str | None = None
    agent_id: str = "default"


class AgentListItem(BaseModel):
    agent_id: str
    name: str
    created_at: str


def get_duckdb_connection() -> duckdb.DuckDBPyConnection:
    """Get DuckDB connection with S3 httpfs configured."""
    config = get_config()

    conn = duckdb.connect()
    conn.execute("INSTALL httpfs; LOAD httpfs;")
    conn.execute(f"SET s3_region='{config.aws_region}';")
    conn.execute("""
        CREATE OR REPLACE SECRET secret (
            TYPE s3,
            PROVIDER credential_chain
        );
    """)

    return conn


def query_sessions(user_id: str, project_id: str) -> list[Session]:
    config = get_config()
    bucket_name = config.session_storage_bucket_name

    if not bucket_name:
        return []

    session_path = f"s3://{bucket_name}/sessions/{user_id}/{project_id}/*/session.json"

    conn = get_duckdb_connection()
    try:
        result = conn.execute(f"""
            SELECT session_id, session_type, created_at, updated_at, session_name, agent_id
            FROM read_json(
                '{session_path}',
                columns={{
                    session_id: 'VARCHAR',
                    session_type: 'VARCHAR',
                    created_at: 'VARCHAR',
                    updated_at: 'VARCHAR',
                    session_name: 'VARCHAR',
                    agent_id: 'VARCHAR'
                }}
            )
            ORDER BY created_at DESC, session_id DESC
        """).fetchall()
    except Exception:
        return []

    return [
        Session(
            session_id=row[0],
            session_type=row[1],
            created_at=row[2],
            updated_at=row[3],
            session_name=row[4],
            agent_id=row[5] or "default",
        )
        for row in result
    ]


def query_agents(user_id: str, project_id: str) -> list[AgentListItem]:
    config = get_config()
    bucket_name = config.agent_storage_bucket_name

    if not bucket_name:
        return []

    s3_path = f"s3://{bucket_name}/{user_id}/{project_id}/agents/*.json"

    conn = get_duckdb_connection()
    try:
        result = conn.execute(f"""
            SELECT
                name,
                content,
                created_at,
                filename
            FROM read_json(
                '{s3_path}',
                columns={{
                    name: 'VARCHAR',
                    content: 'VARCHAR',
                    created_at: 'VARCHAR'
                }},
                filename=true
            )
            ORDER BY created_at DESC
        """).fetchall()
    except Exception:
        return []

    agents = []
    for row in result:
        filename = row[3]
        agent_id = filename.rsplit("/", 1)[-1].replace(".json", "")
        agents.append(
            AgentListItem(
                agent_id=agent_id,
                name=row[0] or agent_id,
                created_at=row[2] or "",
            )
        )

    return agents


# ── Dataset (Parquet) preview & query ──────────────────────────────────────
# DuckDB reads the Parquet directly from S3 via httpfs, so only the requested
# page is materialized regardless of dataset size.

_READ_ONLY_RE = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)
_FORBIDDEN_RE = re.compile(
    r"\b(insert|update|delete|drop|create|alter|attach|copy|install|load|"
    r"pragma|set|export|import|call)\b",
    re.IGNORECASE,
)
_STRING_LITERAL_RE = re.compile(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"")


def is_read_only_sql(query: str) -> bool:
    """Allow only a single SELECT/WITH statement (reject DDL/DML/multi-statement)."""
    stripped = query.strip().rstrip(";")
    if not _READ_ONLY_RE.match(stripped):
        return False
    without_strings = _STRING_LITERAL_RE.sub("''", stripped)
    if ";" in without_strings:
        return False
    return not _FORBIDDEN_RE.search(without_strings)


def _rows_to_dicts(cursor) -> tuple[list[str], list[dict]]:
    columns = [d[0] for d in cursor.description]
    rows = [dict(zip(columns, row, strict=False)) for row in cursor.fetchall()]
    return columns, rows


def get_dataset_schema(dataset_s3_uri: str) -> list[dict]:
    """Return column name/type for a Parquet dataset."""
    conn = get_duckdb_connection()
    safe = dataset_s3_uri.replace("'", "''")
    result = conn.execute(f"DESCRIBE SELECT * FROM read_parquet('{safe}')").fetchall()
    return [{"name": r[0], "type": r[1]} for r in result]


def get_dataset_rows(dataset_s3_uri: str, offset: int = 0, limit: int = 10) -> dict:
    """Return a page of rows plus columns from a Parquet dataset."""
    conn = get_duckdb_connection()
    safe = dataset_s3_uri.replace("'", "''")
    cursor = conn.execute(f"SELECT * FROM read_parquet('{safe}') OFFSET {int(offset)} LIMIT {int(limit)}")
    columns, rows = _rows_to_dicts(cursor)
    return {"columns": columns, "rows": rows}


def run_dataset_query(dataset_s3_uri: str, query: str, offset: int = 0, limit: int = 10) -> dict:
    """Run a read-only SQL query against a dataset (table 'data'), paginated.

    The user query is wrapped as a subquery so results are returned a page at a
    time (LIMIT/OFFSET) even for `SELECT * FROM data`. One extra row is fetched to
    report whether more pages exist.
    """
    if not is_read_only_sql(query):
        raise ValueError("Only read-only SELECT/WITH queries are allowed.")

    conn = get_duckdb_connection()
    safe = dataset_s3_uri.replace("'", "''")
    conn.execute(f"CREATE OR REPLACE TEMP VIEW data AS SELECT * FROM read_parquet('{safe}')")
    inner = query.strip().rstrip(";")
    offset = max(0, offset)
    limit = max(1, min(limit, 100))
    paged = f"SELECT * FROM ({inner}) AS _q OFFSET {offset} LIMIT {limit + 1}"
    cursor = conn.execute(paged)
    columns = [d[0] for d in cursor.description]
    fetched = cursor.fetchall()
    has_more = len(fetched) > limit
    rows = [dict(zip(columns, r, strict=False)) for r in fetched[:limit]]
    return {
        "columns": columns,
        "rows": rows,
        "offset": offset,
        "limit": limit,
        "has_more": has_more,
    }
