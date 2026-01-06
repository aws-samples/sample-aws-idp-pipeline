from functools import lru_cache

from pydantic_settings import BaseSettings


class Config(BaseSettings):
    lancedb_storage_bucket_name: str
    lancedb_lock_table_name: str
    document_storage_bucket_name: str
    backend_table_name: str
    lancedb_express_bucket_name: str


@lru_cache
def get_config() -> Config:
    return Config()
