import pyarrow as pa
from fastapi import APIRouter
from pydantic import BaseModel

from app.lancedb import get_db

VECTOR_DIMENSION = 1024

router = APIRouter(prefix="/tables", tags=["tables"])


def get_document_schema() -> pa.Schema:
    return pa.schema(
        [
            pa.field("document_id", pa.utf8()),
            pa.field("segment_id", pa.utf8()),
            pa.field("segment_index", pa.int32()),
            pa.field("status", pa.utf8()),
            pa.field("content", pa.utf8()),
            pa.field("vector", pa.list_(pa.float32(), VECTOR_DIMENSION)),
            pa.field("keywords", pa.utf8()),
            pa.field("tools_json", pa.utf8()),
            pa.field("content_combined", pa.utf8()),
            pa.field("file_uri", pa.utf8()),
            pa.field("file_type", pa.utf8()),
            pa.field("image_uri", pa.utf8()),
            pa.field("created_at", pa.timestamp("ms")),
            pa.field("updated_at", pa.timestamp("ms")),
        ]
    )


class CreateTableRequest(BaseModel):
    name: str


@router.get("")
def list_tables() -> list[str]:
    db = get_db()
    return db.list_tables().tables


@router.post("")
def create_table(request: CreateTableRequest) -> str:
    db = get_db()
    db.create_table(request.name, schema=get_document_schema())
    return request.name


@router.delete("/{name}")
def delete_table(name: str) -> str:
    db = get_db()
    db.drop_table(name)
    return name
