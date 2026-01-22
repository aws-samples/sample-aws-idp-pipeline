import json

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from app.config import get_config
from app.duckdb import get_duckdb_connection
from app.s3 import delete_s3_prefix, get_s3_client

router = APIRouter(prefix="/chat", tags=["chat"])


class Session(BaseModel):
    session_id: str
    session_type: str
    created_at: str
    updated_at: str
    session_name: str | None = None


class TextContent(BaseModel):
    type: str = "text"
    text: str


class ImageContent(BaseModel):
    type: str = "image"
    format: str
    source: str  # base64 encoded or S3 URL


ContentItem = TextContent | ImageContent


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
def get_project_sessions(
    project_id: str,
    x_user_id: str = Header(alias="x-user-id"),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = Query(default=None),
    after: str | None = Query(default=None, description="Filter sessions created after this ISO timestamp"),
) -> SessionListResponse:
    """Get sessions for a project from S3 using DuckDB."""
    config = get_config()
    bucket_name = config.session_storage_bucket_name

    if not bucket_name:
        raise HTTPException(status_code=500, detail="Session storage bucket not configured")

    s3_path = f"s3://{bucket_name}/sessions/{x_user_id}/{project_id}/*/session.json"

    after_condition = f"WHERE created_at > '{after}'" if after else ""

    conn = get_duckdb_connection()
    try:
        result = conn.execute(f"""
            SELECT session_id, session_type, created_at, updated_at, session_name
            FROM read_json(
                '{s3_path}',
                columns={{
                    session_id: 'VARCHAR',
                    session_type: 'VARCHAR',
                    created_at: 'VARCHAR',
                    updated_at: 'VARCHAR',
                    session_name: 'VARCHAR'
                }}
            )
            {after_condition}
            ORDER BY created_at DESC, session_id DESC
        """).fetchall()
    except Exception:
        return SessionListResponse(sessions=[])

    if cursor:
        cursor_index = next((i for i, row in enumerate(result) if row[0] == cursor), -1)
        if cursor_index >= 0:
            result = result[cursor_index + 1 :]

    has_more = len(result) > limit
    if has_more:
        result = result[:limit]

    sessions = [
        Session(
            session_id=row[0],
            session_type=row[1],
            created_at=row[2],
            updated_at=row[3],
            session_name=row[4],
        )
        for row in result
    ]

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
        parsed_content: list[ContentItem] = []

        for item in content_items:
            if "text" in item and item["text"]:
                parsed_content.append(TextContent(text=item["text"]))
            elif "image" in item:
                img = item["image"]
                source = img.get("source", {})
                # bytes가 있으면 base64, 아니면 S3 URL 등
                bytes_data = source.get("bytes")
                if isinstance(bytes_data, dict) and bytes_data.get("__bytes_encoded__"):
                    source_value = bytes_data.get("data", "")
                elif isinstance(bytes_data, str):
                    source_value = bytes_data
                else:
                    source_value = ""
                parsed_content.append(
                    ImageContent(
                        format=img.get("format", "png"),
                        source=source_value,
                    )
                )

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
def update_session(
    project_id: str,
    session_id: str,
    request: UpdateSessionRequest,
    x_user_id: str = Header(alias="x-user-id"),
) -> Session:
    """Update a session's name."""
    config = get_config()
    bucket_name = config.session_storage_bucket_name

    if not bucket_name:
        raise HTTPException(status_code=500, detail="Session storage bucket not configured")

    s3 = get_s3_client()
    key = f"sessions/{x_user_id}/{project_id}/session_{session_id}/session.json"

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

    return Session(
        session_id=session_data["session_id"],
        session_type=session_data["session_type"],
        created_at=session_data["created_at"],
        updated_at=session_data["updated_at"],
        session_name=session_data["session_name"],
    )


@router.delete("/projects/{project_id}/sessions/{session_id}")
def delete_session(
    project_id: str, session_id: str, x_user_id: str = Header(alias="x-user-id")
) -> DeleteSessionResponse:
    """Delete a session from S3."""
    config = get_config()
    bucket_name = config.session_storage_bucket_name

    if not bucket_name:
        raise HTTPException(status_code=500, detail="Session storage bucket not configured")

    prefix = f"sessions/{x_user_id}/{project_id}/session_{session_id}/"
    deleted_count = delete_s3_prefix(bucket_name, prefix)

    return DeleteSessionResponse(deleted_count=deleted_count)
