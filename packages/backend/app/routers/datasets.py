from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ddb.datasets import get_dataset_item, query_datasets
from app.duckdb import (
    get_dataset_rows,
    get_dataset_schema,
    run_dataset_query,
)

router = APIRouter(prefix="/projects/{project_id}/datasets", tags=["datasets"])


class DatasetResponse(BaseModel):
    dataset_id: str
    name: str
    description: str
    row_count: int | None
    columns: list[str] | None
    source_document_id: str | None
    reference_s3_uri: str | None

    @classmethod
    def from_dataset(cls, ds) -> "DatasetResponse":
        d = ds.data
        return cls(
            dataset_id=d.dataset_id,
            name=d.name,
            description=d.description,
            row_count=d.row_count,
            columns=d.columns,
            source_document_id=d.source_document_id,
            reference_s3_uri=d.reference_s3_uri,
        )


class DatasetQueryRequest(BaseModel):
    query: str
    offset: int = 0
    limit: int = 10


@router.get("")
def list_datasets(project_id: str, source_document_id: str | None = None) -> list[DatasetResponse]:
    """List datasets for a project, optionally filtered by source document."""
    datasets = query_datasets(project_id)
    if source_document_id:
        datasets = [ds for ds in datasets if ds.data.source_document_id == source_document_id]
    return [DatasetResponse.from_dataset(ds) for ds in datasets]


@router.get("/{dataset_id}/schema")
def dataset_schema(project_id: str, dataset_id: str) -> dict:
    ds = get_dataset_item(project_id, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {"columns": get_dataset_schema(ds.data.dataset_s3_uri)}


@router.get("/{dataset_id}/rows")
def dataset_rows(project_id: str, dataset_id: str, offset: int = 0, limit: int = 10) -> dict:
    ds = get_dataset_item(project_id, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    limit = max(1, min(limit, 100))
    result = get_dataset_rows(ds.data.dataset_s3_uri, offset=offset, limit=limit)
    return {
        **result,
        "offset": offset,
        "limit": limit,
        "row_count": ds.data.row_count,
    }


@router.post("/{dataset_id}/query")
def dataset_query(project_id: str, dataset_id: str, request: DatasetQueryRequest) -> dict:
    """Run a read-only SQL query against the dataset (table name: data)."""
    ds = get_dataset_item(project_id, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    try:
        return run_dataset_query(
            ds.data.dataset_s3_uri,
            request.query,
            offset=request.offset,
            limit=request.limit,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001 - surface query errors to the user
        raise HTTPException(status_code=400, detail=f"Query failed: {e}") from e
