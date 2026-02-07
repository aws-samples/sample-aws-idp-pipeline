"""Configuration for WebCrawler Agent."""

import os
from functools import lru_cache

from pydantic_settings import BaseSettings


class Config(BaseSettings):
    """Agent configuration from environment variables."""

    aws_region: str = os.environ.get("AWS_REGION", "us-west-2")
    session_storage_bucket_name: str = os.environ.get("SESSION_STORAGE_BUCKET_NAME", "")
    backend_table_name: str = os.environ.get("BACKEND_TABLE_NAME", "")
    agent_storage_bucket_name: str = os.environ.get("AGENT_STORAGE_BUCKET_NAME", "")
    bedrock_model_id: str = os.environ.get(
        "BEDROCK_MODEL_ID", "global.anthropic.claude-sonnet-4-5-20250929-v1:0"
    )


@lru_cache
def get_config() -> Config:
    """Get cached configuration instance."""
    return Config()
