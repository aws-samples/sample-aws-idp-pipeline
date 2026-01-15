import json
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_config
from app.s3 import get_s3_client

router = APIRouter(prefix="/chat", tags=["chat"])


def get_session_bucket():
    """Get S3 client and bucket name for session storage."""
    config = get_config()
    bucket_name = config.session_storage_bucket_name

    if not bucket_name:
        raise HTTPException(status_code=500, detail="Session storage bucket not configured")

    return get_s3_client(), bucket_name


def get_session_messages_prefix(session_id: str) -> str:
    """Get S3 prefix for session messages."""
    return f"sessions/session_{session_id}/agents/agent_default/messages/"


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatHistoryResponse(BaseModel):
    session_id: str
    messages: list[ChatMessage]


@router.get("/sessions/{session_id}/history")
def get_chat_history(session_id: str) -> ChatHistoryResponse:
    """Get chat history for a session from S3.

    Strands SDK stores messages in:
    sessions/session_{id}/agents/agent_default/messages/message_*.json
    """
    s3, bucket_name = get_session_bucket()
    prefix = get_session_messages_prefix(session_id)

    try:
        # List all message files
        response = s3.list_objects_v2(Bucket=bucket_name, Prefix=prefix)

        if "Contents" not in response:
            return ChatHistoryResponse(session_id=session_id, messages=[])

        # Sort by message number (message_0.json, message_1.json, ...)
        message_keys = []
        for obj in response["Contents"]:
            key = obj["Key"]
            match = re.search(r"message_(\d+)\.json$", key)
            if match:
                message_keys.append((int(match.group(1)), key))

        message_keys.sort(key=lambda x: x[0])

        # Read each message file
        result = []
        for _, key in message_keys:
            try:
                msg_response = s3.get_object(Bucket=bucket_name, Key=key)
                msg_data = json.loads(msg_response["Body"].read().decode("utf-8"))

                # Strands SDK wraps message in "message" key
                message_obj = msg_data.get("message", msg_data)
                role = message_obj.get("role", "")
                content_blocks = message_obj.get("content", [])

                # Extract text content
                text_content = ""
                for block in content_blocks:
                    if isinstance(block, dict) and "text" in block:
                        text_content += block["text"]
                    elif isinstance(block, str):
                        text_content += block

                if text_content and role in ("user", "assistant"):
                    result.append(ChatMessage(role=role, content=text_content))
            except Exception:
                # Skip malformed messages
                continue

        return ChatHistoryResponse(session_id=session_id, messages=result)
    except Exception as e:
        if "NoSuchKey" in str(e) or "NoSuchBucket" in str(e):
            return ChatHistoryResponse(session_id=session_id, messages=[])
        raise HTTPException(status_code=500, detail=f"Failed to get chat history: {str(e)}") from e
