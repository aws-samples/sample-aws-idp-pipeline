"""DatasetProcess Lambda: xlsx/csv -> validate -> parquet -> reference doc -> DATASET#.

Single Step Functions step for the structured-data branch. Runs the whole
pipeline in one Lambda (no inter-step S3 round trips). Each sheet becomes its own
dataset. Identifiers/paths are document_id-based ASCII (Korean file/sheet names
live only in the DATASET# `name`).

Input (from Step Functions):
  { workflow_id, document_id, project_id, file_uri, file_name, file_type }
"""

from __future__ import annotations

import io
import json
import os
import re
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import boto3

if TYPE_CHECKING:
    import pandas as pd

# Heavy libraries (duckdb, pandas, pyarrow, openpyxl, strands via reference) are
# imported lazily inside the handler. Lambda's init phase has a hard ~10s limit
# and these imports exceed it; deferring them to the handler (15 min budget)
# avoids the init timeout / re-init on cold start.
from shared.ddb_client import (
    StepName,
    WorkflowStatus,
    get_document,
    get_entity_prefix,
    record_step_complete,
    record_step_needs_fix,
    record_step_start,
    save_dataset,
    update_workflow_status,
)
from validator import validate_workbook

_s3 = boto3.client("s3")
_lambda = boto3.client("lambda")

LANCEDB_FUNCTION_NAME = os.environ.get("LANCEDB_FUNCTION_NAME", "idp-v2-lance-service")


def _parse_s3_uri(uri: str) -> tuple[str, str]:
    p = urlparse(uri)
    return p.netloc, p.path.lstrip("/")


def _index_dataset_catalog(
    project_id: str,
    dataset_id: str,
    dataset_s3_uri: str,
    name: str,
    description: str,
    columns: list[str],
    row_count: int,
) -> None:
    """Index a dataset into the per-project catalog (LanceDB) for search_datasets.

    Best-effort: a catalog failure must not fail dataset creation, since the
    dataset itself (DATASET# + Parquet) is already usable.
    """
    try:
        resp = _lambda.invoke(
            FunctionName=LANCEDB_FUNCTION_NAME,
            InvocationType="RequestResponse",
            Payload=json.dumps(
                {
                    "action": "add_dataset",
                    "params": {
                        "project_id": project_id,
                        "dataset_id": dataset_id,
                        "dataset_s3_uri": dataset_s3_uri,
                        "name": name,
                        "description": description,
                        "columns": columns,
                        "row_count": row_count,
                    },
                }
            ),
        )
        if "FunctionError" in resp:
            print(
                f"Dataset catalog indexing error for {dataset_id}: "
                f"{resp['Payload'].read().decode('utf-8')}"
            )
    except Exception as e:  # noqa: BLE001 - catalog is best-effort
        print(f"Dataset catalog indexing failed for {dataset_id}: {e}")


def _snake_case(name: str) -> str:
    """Normalize a column name to a safe snake_case SQL identifier.

    Makes columns queryable without double-quoting (e.g. 'Primary Type' ->
    'primary_type', 'Sp.Atk' -> 'sp_atk', '#' -> 'col'). Handles camelCase,
    spaces, punctuation, and leading digits.
    """
    s = str(name).strip()
    # Split camelCase / PascalCase boundaries: "fooBar" -> "foo Bar".
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", s)
    s = s.lower()
    # Any run of non-alphanumeric characters becomes a single underscore.
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    # Identifiers cannot start with a digit.
    if s and s[0].isdigit():
        s = f"c_{s}"
    return s or "col"


def _snake_case_columns(df: "pd.DataFrame") -> "pd.DataFrame":
    """Rename all DataFrame columns to unique snake_case identifiers.

    On collision (e.g. 'Sp.Atk' and 'Sp Atk' both -> 'sp_atk', or a source that
    already contains 'valid_from' and 'Valid from.1'), a numeric suffix is
    appended. The suffixed name is also checked against every name already taken,
    so a generated name (e.g. 'valid_from_1') can never collide with a later
    source column that normalizes to the same string.
    """
    used: set[str] = set()
    new_cols = []
    for col in df.columns:
        base = _snake_case(col)
        candidate = base
        i = 0
        while candidate in used:
            i += 1
            candidate = f"{base}_{i}"
        used.add(candidate)
        new_cols.append(candidate)
    df.columns = new_cols
    return df


def _normalize_mixed_columns(df: "pd.DataFrame") -> "pd.DataFrame":
    """Coerce mixed-type object columns to string so Parquet conversion succeeds.

    Excel/CSV columns frequently mix types in one column (e.g. Titanic's 'Ticket'
    holds both "A/5 21171" and 349909). pandas keeps these as an object column,
    but pyarrow infers the Arrow type from the first value and then raises
    ArrowTypeError ("Expected bytes, got a 'int' object") on the first value of a
    different type. We only touch object columns that actually contain more than
    one Python type among non-null values, casting them to string. Clean
    single-type columns (numeric, all-string) are left untouched so their Parquet
    types stay correct for SQL. NaN is preserved (not turned into the text 'nan').
    """
    import pandas as pd

    for col in df.columns:
        if df[col].dtype != object:
            continue
        non_null = df[col].dropna()
        types = {type(v) for v in non_null}
        if len(types) > 1:
            df[col] = df[col].map(lambda v: v if pd.isna(v) else str(v))
    return df


def _output_dir(document_key: str) -> str:
    """Directory to write parquet/reference into: a `dataset/` subfolder under the
    original document's folder.

    e.g. projects/{pid}/documents/{doc_id}/{doc_id}.xlsx
      -> projects/{pid}/documents/{doc_id}/dataset

    The `dataset/` subfolder is deliberate: the S3-upload EventBridge rule excludes
    keys matching `projects/*/documents/*/*/*` (6+ segments), so outputs written one
    level below documents/{doc_id}/ (like analysis/, bda-output/) never re-trigger
    the workflow. Writing directly to documents/{doc_id}/{doc_id}.parquet (5 segments,
    same depth as the original upload) WOULD re-trigger it.
    """
    return document_key.rsplit("/", 1)[0] + "/dataset"


def handler(event: dict, context) -> dict:
    workflow_id = event["workflow_id"]
    document_id = event["document_id"]
    project_id = event["project_id"]
    file_uri = event["file_uri"]
    file_type = event.get("file_type", "")

    # Prefer the original upload filename (stored on the DOC# item) over the
    # event's file_name, which is document_id-based (S3 key = {doc_id}.{ext}).
    # get_document returns the item's `data` dict directly.
    file_name = event.get("file_name", document_id)
    doc_data = get_document(project_id, document_id)
    if doc_data and doc_data.get("name"):
        file_name = doc_data["name"]

    entity_type = get_entity_prefix(file_type)
    record_step_start(workflow_id, StepName.DATASET_PROCESS)

    bucket, key = _parse_s3_uri(file_uri)
    body = _s3.get_object(Bucket=bucket, Key=key)["Body"].read()

    # Delimited text (csv/tsv) vs Excel workbook. TSV is CSV with a tab separator.
    name_lower = file_name.lower()
    is_tsv = file_type == "text/tab-separated-values" or name_lower.endswith(".tsv")
    is_csv = file_type == "text/csv" or name_lower.endswith(".csv")
    is_xls = file_type == "application/vnd.ms-excel" or name_lower.endswith(".xls")
    delimiter = "\t" if is_tsv else ("," if is_csv else None)

    # 1) Load sheets as DataFrames + validate.
    try:
        sheets, failures = _load_and_validate(body, delimiter, is_xls, file_name)
    except Exception as e:  # noqa: BLE001 - unreadable file is a user-fix case
        reason = f"파일을 읽을 수 없습니다: {e}"
        record_step_needs_fix(workflow_id, StepName.DATASET_PROCESS, reason)
        update_workflow_status(document_id, workflow_id, WorkflowStatus.NEEDS_USER_FIX, entity_type)
        return {"workflow_id": workflow_id, "status": WorkflowStatus.NEEDS_USER_FIX, "reason": reason}

    if not sheets:
        reason = _format_failures(failures)
        record_step_needs_fix(workflow_id, StepName.DATASET_PROCESS, reason, {"sheets": failures})
        update_workflow_status(document_id, workflow_id, WorkflowStatus.NEEDS_USER_FIX, entity_type)
        return {"workflow_id": workflow_id, "status": WorkflowStatus.NEEDS_USER_FIX, "reason": reason}

    # 2) Per valid sheet: parquet -> reference -> DATASET#.
    # Outputs live alongside the original document under documents/{doc_id}/.
    out_bucket = bucket
    out_dir = _output_dir(key)
    created = []
    for sheet in sheets:
        dataset_id = document_id if sheet["single"] else f"{document_id}__{sheet['index']}"
        parquet_key = f"{out_dir}/{dataset_id}.parquet"
        reference_key = f"{out_dir}/{dataset_id}.txt"
        parquet_uri = f"s3://{out_bucket}/{parquet_key}"
        reference_uri = f"s3://{out_bucket}/{reference_key}"

        # Normalize columns to snake_case so SQL can reference them without
        # double-quoting (e.g. "Primary Type" -> primary_type). Applied here,
        # after validation, so both the Parquet and the reference doc/DDB use
        # the same normalized names.
        df = _snake_case_columns(sheet["df"])
        # Coerce mixed-type columns to string so Parquet conversion can't fail on
        # a column that holds e.g. both ints and strings (common in spreadsheets).
        df = _normalize_mixed_columns(df)

        # parquet -> S3
        buf = io.BytesIO()
        df.to_parquet(buf, index=False)
        buf.seek(0)
        _s3.put_object(Bucket=out_bucket, Key=parquet_key, Body=buf.getvalue())

        # reference doc via DuckDB profiling + Bedrock (lazy imports, see top)
        import duckdb
        import pyarrow as pa

        from reference import build_reference

        con = duckdb.connect()
        con.register("data", pa.Table.from_pandas(df, preserve_index=False))
        display_name = file_name if sheet["single"] else f"{file_name} / {sheet['name']}"
        description = ""
        try:
            reference, description = build_reference(con, display_name)
            _s3.put_object(
                Bucket=out_bucket, Key=reference_key,
                Body=reference.encode("utf-8"), ContentType="text/plain; charset=utf-8",
            )
            ref_uri = reference_uri
        except Exception as e:  # noqa: BLE001 - reference is best-effort; dataset still usable
            print(f"Reference generation failed for {dataset_id}: {e}")
            ref_uri = ""
        finally:
            con.close()

        columns = [str(c) for c in df.columns]
        save_dataset(
            project_id=project_id,
            dataset_id=dataset_id,
            name=display_name,
            description=description,
            dataset_s3_uri=parquet_uri,
            reference_s3_uri=ref_uri,
            row_count=int(len(df)),
            columns=columns,
            source_document_id=document_id,
        )
        # Index into the per-project dataset catalog so the agent can find this
        # dataset by name/description (search_datasets) instead of listing all.
        _index_dataset_catalog(
            project_id=project_id,
            dataset_id=dataset_id,
            dataset_s3_uri=parquet_uri,
            name=display_name,
            description=description,
            columns=columns,
            row_count=int(len(df)),
        )
        created.append({"dataset_id": dataset_id, "dataset_s3_uri": parquet_uri, "rows": int(len(df))})

    # Surface partially-skipped sheets to the user. Even though the workflow is
    # completed (at least one sheet succeeded), the UI should show which sheets
    # were excluded and why, rather than silently dropping them.
    skipped_reason = ""
    if failures:
        skipped_reason = (
            f"{len(created)}개 시트만 처리되었습니다. "
            f"{len(failures)}개 시트는 정형 데이터로 변환할 수 없어 제외되었습니다: "
            + _format_failures(failures)
        )
    record_step_complete(
        workflow_id, StepName.DATASET_PROCESS,
        dataset_count=len(created),
        skipped_sheets=len(failures),
        reason=skipped_reason,
        skipped_detail=failures,
    )
    update_workflow_status(
        document_id, workflow_id, WorkflowStatus.COMPLETED, entity_type,
        dataset_count=len(created),
    )
    return {
        "workflow_id": workflow_id,
        "status": WorkflowStatus.COMPLETED,
        "datasets": created,
        "skipped_sheets": failures,
    }


def _load_and_validate(
    body: bytes, delimiter: str | None, is_xls: bool, file_name: str
):
    """Return (valid_sheets, failures). valid_sheets carry the DataFrame to write.

    delimiter is set for delimited text (',' for CSV, '\\t' for TSV); None for Excel.
    is_xls marks the legacy .xls format (openpyxl can't read it -> use xlrd).
    """
    import pandas as pd

    if delimiter is not None:
        df = pd.read_csv(io.BytesIO(body), sep=delimiter)
        reasons = _validate_dataframe(df)
        if reasons:
            return [], [{"sheet_name": file_name, "sheet_index": 0, "reasons": reasons}]
        return [{"df": df, "name": file_name, "index": 0, "single": True}], []

    if is_xls:
        # Legacy .xls: openpyxl can't open BIFF, so read every sheet with pandas
        # (xlrd engine) and validate the resulting DataFrames. Structural checks
        # (merged cells / images) are not available for this format.
        book = pd.read_excel(io.BytesIO(body), sheet_name=None, engine="xlrd")
        names = list(book.keys())
        sheets = []
        failures = []
        for idx, name in enumerate(names):
            df = book[name]
            reasons = _validate_dataframe(df)
            if reasons:
                failures.append(
                    {"sheet_name": name, "sheet_index": idx, "reasons": reasons}
                )
            else:
                sheets.append({"df": df, "name": name, "index": idx, "single": False})
        if not sheets:
            return [], failures
        if len(sheets) == 1 and len(names) == 1:
            sheets[0]["single"] = True
        return sheets, failures

    # Excel (.xlsx): validate structure with openpyxl, then read valid sheets.
    # NOTE: read_only=True omits merged_cells/_images/_charts, which the validator
    # needs, so load in normal mode.
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(body), data_only=True)
    validations = validate_workbook(wb)
    wb.close()

    valid = [v for v in validations if v.ok]
    failures = [
        {"sheet_name": v.sheet_name, "sheet_index": v.sheet_index, "reasons": v.reasons}
        for v in validations
        if not v.ok
    ]
    if not valid:
        return [], failures

    single = len(valid) == 1 and len(validations) == 1
    sheets = []
    for v in valid:
        df = pd.read_excel(io.BytesIO(body), sheet_name=v.sheet_name)
        sheets.append({"df": df, "name": v.sheet_name, "index": v.sheet_index, "single": single})
    return sheets, failures


def _validate_dataframe(df: pd.DataFrame) -> list[str]:
    """Lightweight validation for CSV (openpyxl checks cover Excel).

    Neither duplicate nor unnamed/empty header columns are rejected: snake_case
    normalization gives every column a unique, valid identifier automatically
    (see _snake_case_columns; pandas 'Unnamed: 0' -> unnamed_0, a blank header ->
    col/col_1). Rejecting them would fail common exports (e.g. a leading index
    column from df.to_csv()) that are otherwise perfectly tabular. No column is
    dropped, so no data is lost.
    """
    reasons = []
    if df.empty:
        reasons.append("데이터 행이 없습니다.")
    return reasons


def _format_failures(failures: list[dict]) -> str:
    parts = []
    for f in failures:
        parts.append(f"[{f['sheet_name']}] " + " ".join(f["reasons"]))
    joined = " / ".join(parts) if parts else "정형 데이터로 처리할 수 없습니다."
    return (
        "정형 데이터로 처리할 수 없습니다. 표 형태로 정리 후 다시 업로드하세요. "
        + joined
    )
