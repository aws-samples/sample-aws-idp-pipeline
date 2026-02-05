import json
import logging

import boto3

from config import get_config

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT = """
You are an Intelligent Document Processing (IDP) assistant.
Your role is to help users find and understand information from their uploaded documents.
Provide accurate answers based on the search results and cite the source when answering.

When using search__summarize tool, you don't need to worry about user_id or project_id parameters - they will be automatically filled by the system.
"""


def fetch_system_prompt() -> str | None:
    """Fetch system prompt from S3."""
    config = get_config()
    if not config.agent_storage_bucket_name:
        return None

    s3 = boto3.client("s3")
    key = "__prompts/system_prompt.txt"

    try:
        response = s3.get_object(
            Bucket=config.agent_storage_bucket_name,
            Key=key,
        )
        return response["Body"].read().decode("utf-8")
    except Exception as e:
        logger.error(f"Failed to fetch system prompt: {e}")
        return None


def fetch_custom_agent_prompt(user_id: str, project_id: str, agent_id: str) -> str | None:
    """Fetch custom agent prompt from S3."""
    config = get_config()
    if not config.agent_storage_bucket_name:
        return None

    s3 = boto3.client("s3")
    key = f"{user_id}/{project_id}/agents/{agent_id}.json"

    try:
        response = s3.get_object(
            Bucket=config.agent_storage_bucket_name,
            Key=key,
        )
        data = json.loads(response["Body"].read().decode("utf-8"))
        return data.get("content")
    except s3.exceptions.NoSuchKey:
        logger.warning(f"Agent not found: {agent_id}")
        return None
    except Exception as e:
        logger.error(f"Failed to fetch agent prompt: {e}")
        return None
