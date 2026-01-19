from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.config import get_config
from app.duckdb import get_duckdb_connection

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
        FROM read_json_auto('{s3_path}')
        ORDER BY created_at DESC
    """).fetchall()

    return [
        Session(
            session_id=row[0],
            session_type=row[1],
            created_at=row[2],
            updated_at=row[3],
            session_name=row[4],
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

    return ChatHistoryResponse(
        session_id=session_id,
        messages=[ChatMessage(role=row[0], content=row[1], created_at=row[2], updated_at=row[3]) for row in result],
    )
