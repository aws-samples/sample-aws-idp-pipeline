from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    aws_region: str = "us-east-1"
    lancedb_storage_bucket_name: str = ""
    lancedb_lock_table_name: str = ""
    document_storage_bucket_name: str = ""
    backend_table_name: str = ""
    lancedb_express_bucket_name: str = ""
    websocket_endpoint: str = ""
    session_storage_bucket_name: str = ""


@lru_cache
def get_config() -> Config:
    return Config()
