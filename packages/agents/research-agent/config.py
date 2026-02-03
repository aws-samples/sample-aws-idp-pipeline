import logging
from functools import lru_cache

import boto3
from botocore.exceptions import ClientError
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

UNSPLASH_SSM_KEY = "/idp-v2/external-service/unsplash/access-key"


class Config(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.local", env_file_encoding="utf-8", extra="ignore"
    )

    aws_region: str = "us-east-1"
    agent_storage_bucket_name: str = ""
    session_storage_bucket_name: str = ""
    mcp_gateway_url: str = ""
    unsplash_access_key: str = ""


def _get_ssm_parameter(name: str, region: str) -> str | None:
    """Get parameter value from SSM Parameter Store."""
    try:
        ssm = boto3.client("ssm", region_name=region)
        response = ssm.get_parameter(Name=name, WithDecryption=True)
        return response["Parameter"]["Value"]
    except ClientError as e:
        logger.debug(f"SSM parameter {name} not found: {e}")
        return None


@lru_cache
def get_config() -> Config:
    config = Config()

    # Load Unsplash access key from SSM if not set via environment variable
    if not config.unsplash_access_key:
        ssm_value = _get_ssm_parameter(UNSPLASH_SSM_KEY, config.aws_region)
        if ssm_value:
            config.unsplash_access_key = ssm_value
            logger.info("Loaded Unsplash access key from SSM")

    return config
