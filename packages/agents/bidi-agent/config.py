from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.local", env_file_encoding="utf-8", extra="ignore"
    )

    aws_region: str = "us-east-1"
    agent_storage_bucket_name: str = ""
    session_storage_bucket_name: str = ""


@lru_cache
def get_config() -> Config:
    return Config()
