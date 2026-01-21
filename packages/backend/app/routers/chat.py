import json

from fastapi import APIRouter, Header, HTTPException
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


class ChatMessage(BaseModel):
    role: str
    content: str
    created_at: str
    updated_at: str


class ChatHistoryResponse(BaseModel):
    session_id: str
    messages: list[ChatMessage]


@router.get("/projects/{project_id}/sessions")
def get_project_sessions(project_id: str, x_user_id: str = Header(alias="x-user-id")) -> list[Session]:
    """Get sessions for a project from S3 using DuckDB."""
    config = get_config()
    bucket_name = config.session_storage_bucket_name

    if not bucket_name:
        raise HTTPException(status_code=500, detail="Session storage bucket not configured")

    s3_path = f"s3://{bucket_name}/sessions/{x_user_id}/{project_id}/*/session.json"

    conn = get_duckdb_connection()
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
        ORDER BY created_at DESC
    """).fetchall()

    return [
        Session(
            session_id=row[0],
            session_type=row[1],
            created_at=row[2],
            updated_at=row[3],
            session_name=None,
        )
        for row in result
    ]


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
    print(s3_path)

    conn = get_duckdb_connection()
    try:
        result = conn.execute(f"""
            SELECT
                message.role as role,
                string_agg(content_item.text, '') as content,
                created_at,
                updated_at
            FROM read_json_auto('{s3_path}'),
            UNNEST(message.content) as t(content_item)
            WHERE message.role IN ('user', 'assistant')
            GROUP BY message_id, message.role, created_at, updated_at
            ORDER BY message_id
        """).fetchall()
    except Exception:
        return ChatHistoryResponse(session_id=session_id, messages=[])

    return ChatHistoryResponse(
        session_id=session_id,
        messages=[ChatMessage(role=row[0], content=row[1], created_at=row[2], updated_at=row[3]) for row in result],
    )


class UpdateSessionRequest(BaseModel):
    session_name: str


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
def delete_session(project_id: str, session_id: str, x_user_id: str = Header(alias="x-user-id")) -> dict:
    """Delete a session from S3."""
    config = get_config()
    bucket_name = config.session_storage_bucket_name

    if not bucket_name:
        raise HTTPException(status_code=500, detail="Session storage bucket not configured")

    prefix = f"sessions/{x_user_id}/{project_id}/session_{session_id}/"
    deleted_count = delete_s3_prefix(bucket_name, prefix)

    return {"deleted_count": deleted_count}
