from fastapi import APIRouter
from pydantic import BaseModel

from app.config import get_config
from app.s3 import get_s3_client

router = APIRouter(prefix="/prompts", tags=["prompts"])

SYSTEM_PROMPT_KEY = "__prompts/system_prompt.txt"


class SystemPromptUpdate(BaseModel):
    content: str


class SystemPromptResponse(BaseModel):
    content: str


@router.get("/system")
def get_system_prompt() -> SystemPromptResponse:
    """Get the global system prompt."""
    config = get_config()
    s3 = get_s3_client()

    try:
        response = s3.get_object(
            Bucket=config.agent_storage_bucket_name,
            Key=SYSTEM_PROMPT_KEY,
        )
        content = response["Body"].read().decode("utf-8")
        return SystemPromptResponse(content=content)
    except s3.exceptions.NoSuchKey:
        return SystemPromptResponse(content="")


@router.put("/system")
def update_system_prompt(request: SystemPromptUpdate) -> SystemPromptResponse:
    """Update the global system prompt."""
    config = get_config()
    s3 = get_s3_client()

    s3.put_object(
        Bucket=config.agent_storage_bucket_name,
        Key=SYSTEM_PROMPT_KEY,
        Body=request.content.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
    )

    return SystemPromptResponse(content=request.content)
