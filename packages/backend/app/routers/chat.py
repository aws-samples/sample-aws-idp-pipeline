import json

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from app.cache import CacheKey, invalidate
from app.config import get_config
from app.duckdb import get_duckdb_connection
from app.message import ContentItem, parse_content_items
from app.s3 import delete_s3_prefix, get_s3_client
from app.sessions import Session

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: list[ContentItem]
    created_at: str
    updated_at: str


class ChatHistoryResponse(BaseModel):
    session_id: str
    messages: list[ChatMessage]


class SessionListResponse(BaseModel):
    sessions: list[Session]
    next_cursor: str | None = None


@router.get("/projects/{project_id}/sessions")
async def get_project_sessions(
    project_id: str,
    x_user_id: str = Header(alias="x-user-id"),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = Query(default=None),
    after: str | None = Query(default=None, description="Filter sessions created after this ISO timestamp"),
) -> SessionListResponse:
    """Get sessions for a project from S3 using DuckDB."""
    from app.cache import cached_query_sessions

    sessions = await cached_query_sessions(x_user_id, project_id)

    if after:
        sessions = [s for s in sessions if s.created_at > after]

    if cursor:
        cursor_index = next((i for i, s in enumerate(sessions) if s.session_id == cursor), -1)
        if cursor_index >= 0:
            sessions = sessions[cursor_index + 1 :]

    has_more = len(sessions) > limit
    if has_more:
        sessions = sessions[:limit]

    next_cursor = sessions[-1].session_id if has_more and sessions else None

    return SessionListResponse(sessions=sessions, next_cursor=next_cursor)


@router.get("/projects/{project_id}/sessions/{session_id}")
def get_chat_history(
    project_id: str, session_id: str, x_user_id: str = Header(alias="x-user-id")
) -> ChatHistoryResponse:
    """Get chat history for a session from S3 using DuckDB."""
    config = get_config()
    bucket_name = config.session_storage_bucket_name

    if not bucket_name:
        raise HTTPException(status_code=500, detail="Session storage bucket not configured")

    s3_path = f"s3://{bucket_name}/sessions/{x_user_id}/{project_id}/session_{session_id}/agents/agent_default/messages/message_*.json"

    conn = get_duckdb_connection()
    try:
        result = conn.execute(f"""
            SELECT
                message_id,
                message.role as role,
                message.content as content,
                created_at,
                updated_at
            FROM read_json_auto('{s3_path}')
            WHERE message.role IN ('user', 'assistant')
            ORDER BY message_id
        """).fetchall()
    except Exception:
        return ChatHistoryResponse(session_id=session_id, messages=[])

    messages = []
    for row in result:
        role, content_items, created_at, updated_at = row[1], row[2], row[3], row[4]
        parsed_content = parse_content_items(content_items)

        if parsed_content:
            messages.append(
                ChatMessage(
                    role=role,
                    content=parsed_content,
                    created_at=created_at,
                    updated_at=updated_at,
                )
            )

    return ChatHistoryResponse(session_id=session_id, messages=messages)


class UpdateSessionRequest(BaseModel):
    session_name: str


class DeleteSessionResponse(BaseModel):
    deleted_count: int


@router.patch("/projects/{project_id}/sessions/{session_id}")
async def update_session(
    project_id: str,
    session_id: str,
    request: UpdateSessionRequest,
    user_id: str = Header(alias="x-user-id"),
) -> Session:
    """Update a session's name."""
    config = get_config()
    bucket_name = config.session_storage_bucket_name

    if not bucket_name:
        raise HTTPException(status_code=500, detail="Session storage bucket not configured")

    s3 = get_s3_client()
    key = f"sessions/{user_id}/{project_id}/session_{session_id}/session.json"

    try:
        response = s3.get_object(Bucket=bucket_name, Key=key)
    except s3.exceptions.NoSuchKey:
        raise HTTPException(status_code=404, detail="Session not found") from None

    session_data = json.loads(response["Body"].read().decode("utf-8"))

    session_data["session_name"] = request.session_name

    s3.put_object(
        Bucket=bucket_name,
        Key=key,
        Body=json.dumps(session_data),
        ContentType="application/json",
    )

    await invalidate(CacheKey.session_list(user_id, project_id))

    return Session(
        session_id=session_data["session_id"],
        session_type=session_data["session_type"],
        created_at=session_data["created_at"],
        updated_at=session_data["updated_at"],
        session_name=session_data["session_name"],
    )


@router.delete("/projects/{project_id}/sessions/{session_id}")
async def delete_session(
    project_id: str, session_id: str, user_id: str = Header(alias="x-user-id")
) -> DeleteSessionResponse:
    """Delete a session from S3."""
    config = get_config()
    bucket_name = config.session_storage_bucket_name

    if not bucket_name:
        raise HTTPException(status_code=500, detail="Session storage bucket not configured")

    prefix = f"sessions/{user_id}/{project_id}/session_{session_id}/"
    deleted_count = delete_s3_prefix(bucket_name, prefix)

    await invalidate(CacheKey.session_list(user_id, project_id))

    return DeleteSessionResponse(deleted_count=deleted_count)
