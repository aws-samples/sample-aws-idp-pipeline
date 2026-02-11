from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_config
from app.s3 import get_s3_client

router = APIRouter(prefix="/prompts", tags=["prompts"])

SYSTEM_PROMPT_KEY = "__prompts/chat/system_prompt.txt"
VOICE_SYSTEM_PROMPT_KEY = "__prompts/voice/system_prompt.txt"
WEBCRAWLER_SYSTEM_PROMPT_KEY = "__prompts/webcrawler/system_prompt.txt"

ANALYSIS_PROMPT_KEYS = {
    "system": "__prompts/analysis/system_prompt.txt",
    "user-query": "__prompts/analysis/user_query.txt",
    "image": "__prompts/analysis/image_analysis_prompt.txt",
    "video-system": "__prompts/analysis/video_system_prompt.txt",
    "video-user-query": "__prompts/analysis/video_user_query.txt",
    "video": "__prompts/analysis/video_analysis_prompt.txt",
    "text-system": "__prompts/analysis/text_system_prompt.txt",
    "text-user-query": "__prompts/analysis/text_user_query.txt",
}


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


@router.get("/voice-system")
def get_voice_system_prompt() -> SystemPromptResponse:
    """Get the voice system prompt."""
    config = get_config()
    s3 = get_s3_client()

    try:
        response = s3.get_object(
            Bucket=config.agent_storage_bucket_name,
            Key=VOICE_SYSTEM_PROMPT_KEY,
        )
        content = response["Body"].read().decode("utf-8")
        return SystemPromptResponse(content=content)
    except s3.exceptions.NoSuchKey:
        return SystemPromptResponse(content="")


@router.put("/voice-system")
def update_voice_system_prompt(request: SystemPromptUpdate) -> SystemPromptResponse:
    """Update the voice system prompt."""
    config = get_config()
    s3 = get_s3_client()

    s3.put_object(
        Bucket=config.agent_storage_bucket_name,
        Key=VOICE_SYSTEM_PROMPT_KEY,
        Body=request.content.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
    )

    return SystemPromptResponse(content=request.content)


@router.get("/webcrawler")
def get_webcrawler_prompt() -> SystemPromptResponse:
    """Get the webcrawler system prompt."""
    config = get_config()
    s3 = get_s3_client()

    try:
        response = s3.get_object(
            Bucket=config.agent_storage_bucket_name,
            Key=WEBCRAWLER_SYSTEM_PROMPT_KEY,
        )
        content = response["Body"].read().decode("utf-8")
        return SystemPromptResponse(content=content)
    except s3.exceptions.NoSuchKey:
        return SystemPromptResponse(content="")


@router.put("/webcrawler")
def update_webcrawler_prompt(request: SystemPromptUpdate) -> SystemPromptResponse:
    """Update the webcrawler system prompt."""
    config = get_config()
    s3 = get_s3_client()

    s3.put_object(
        Bucket=config.agent_storage_bucket_name,
        Key=WEBCRAWLER_SYSTEM_PROMPT_KEY,
        Body=request.content.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
    )

    return SystemPromptResponse(content=request.content)


@router.get("/analysis/{prompt_type}")
def get_analysis_prompt(prompt_type: str) -> SystemPromptResponse:
    """Get an analysis prompt by type."""
    s3_key = ANALYSIS_PROMPT_KEYS.get(prompt_type)
    if not s3_key:
        raise HTTPException(status_code=404, detail=f"Unknown prompt type: {prompt_type}")

    config = get_config()
    s3 = get_s3_client()

    try:
        response = s3.get_object(
            Bucket=config.agent_storage_bucket_name,
            Key=s3_key,
        )
        content = response["Body"].read().decode("utf-8")
        return SystemPromptResponse(content=content)
    except s3.exceptions.NoSuchKey:
        return SystemPromptResponse(content="")


@router.put("/analysis/{prompt_type}")
def update_analysis_prompt(prompt_type: str, request: SystemPromptUpdate) -> SystemPromptResponse:
    """Update an analysis prompt by type."""
    s3_key = ANALYSIS_PROMPT_KEYS.get(prompt_type)
    if not s3_key:
        raise HTTPException(status_code=404, detail=f"Unknown prompt type: {prompt_type}")

    config = get_config()
    s3 = get_s3_client()

    s3.put_object(
        Bucket=config.agent_storage_bucket_name,
        Key=s3_key,
        Body=request.content.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
    )

    return SystemPromptResponse(content=request.content)
