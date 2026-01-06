import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Config:
    lancedb_storage_bucket_name: str
    lancedb_lock_table_name: str
    document_storage_bucket_name: str
    backend_table_name: str


@lru_cache
def get_config() -> Config:
    return Config(
        lancedb_storage_bucket_name=os.environ["LANCEDB_STORAGE_BUCKET_NAME"],
        lancedb_lock_table_name=os.environ["LANCEDB_LOCK_TABLE_NAME"],
        document_storage_bucket_name=os.environ["DOCUMENT_STORAGE_BUCKET_NAME"],
        backend_table_name=os.environ["BACKEND_TABLE_NAME"],
    )
