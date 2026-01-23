import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.config import get_config
from app.duckdb import get_duckdb_connection
from app.s3 import get_s3_client

router = APIRouter(prefix="/projects/{project_id}/agents", tags=["agents"])


class AgentCreate(BaseModel):
    name: str
    content: str


class AgentUpdate(BaseModel):
    name: str
    content: str


class AgentResponse(BaseModel):
    agent_id: str
    name: str
    content: str
    created_at: str


class AgentListItem(BaseModel):
    agent_id: str
    name: str
    created_at: str


def _get_agents_prefix(user_id: str, project_id: str) -> str:
    return f"{user_id}/{project_id}/agents/"


def _get_agent_key(user_id: str, project_id: str, agent_id: str) -> str:
    return f"{_get_agents_prefix(user_id, project_id)}{agent_id}.json"


@router.get("")
def list_agents(project_id: str, x_user_id: str = Header(alias="x-user-id")) -> list[AgentListItem]:
    """List all agents for a user's project."""
    config = get_config()
    bucket_name = config.agent_storage_bucket_name

    if not bucket_name:
        return []

    s3_path = f"s3://{bucket_name}/{x_user_id}/{project_id}/agents/*.json"

    conn = get_duckdb_connection()
    try:
        result = conn.execute(f"""
            SELECT
                name,
                content,
                created_at,
                filename
            FROM read_json(
                '{s3_path}',
                columns={{
                    name: 'VARCHAR',
                    content: 'VARCHAR',
                    created_at: 'VARCHAR'
                }},
                filename=true
            )
            ORDER BY created_at DESC
        """).fetchall()
    except Exception:
        return []

    agents = []
    for row in result:
        filename = row[3]
        agent_id = filename.rsplit("/", 1)[-1].replace(".json", "")
        agents.append(
            AgentListItem(
                agent_id=agent_id,
                name=row[0] or agent_id,
                created_at=row[2] or "",
            )
        )

    return agents


@router.post("")
def create_agent(project_id: str, request: AgentCreate, x_user_id: str = Header(alias="x-user-id")) -> AgentResponse:
    """Create a new agent with auto-generated UUID."""
    config = get_config()
    s3 = get_s3_client()

    agent_id = str(uuid.uuid4())
    key = _get_agent_key(x_user_id, project_id, agent_id)

    now = datetime.now(UTC).isoformat()
    data = {
        "name": request.name,
        "content": request.content,
        "created_at": now,
    }

    s3.put_object(
        Bucket=config.agent_storage_bucket_name,
        Key=key,
        Body=json.dumps(data, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )

    return AgentResponse(
        agent_id=agent_id,
        name=request.name,
        content=request.content,
        created_at=now,
    )


@router.get("/{agent_id}")
def get_agent(project_id: str, agent_id: str, x_user_id: str = Header(alias="x-user-id")) -> AgentResponse:
    """Get a specific agent by ID."""
    config = get_config()
    s3 = get_s3_client()

    key = _get_agent_key(x_user_id, project_id, agent_id)

    try:
        response = s3.get_object(Bucket=config.agent_storage_bucket_name, Key=key)
        data = json.loads(response["Body"].read().decode("utf-8"))
        last_modified = response["LastModified"].isoformat()

        return AgentResponse(
            agent_id=agent_id,
            name=data.get("name", ""),
            content=data.get("content", ""),
            created_at=data.get("created_at", last_modified),
        )
    except s3.exceptions.NoSuchKey as e:
        raise HTTPException(status_code=404, detail="Agent not found") from e


@router.put("/{agent_id}")
def upsert_agent(
    project_id: str, agent_id: str, request: AgentUpdate, x_user_id: str = Header(alias="x-user-id")
) -> AgentResponse:
    """Create or update an agent (upsert)."""
    config = get_config()
    s3 = get_s3_client()

    key = _get_agent_key(x_user_id, project_id, agent_id)
    now = datetime.now(UTC).isoformat()

    # Try to get existing created_at
    created_at = now
    try:
        existing = s3.get_object(Bucket=config.agent_storage_bucket_name, Key=key)
        existing_data = json.loads(existing["Body"].read().decode("utf-8"))
        created_at = existing_data.get("created_at", now)
    except Exception:
        pass

    data = {
        "name": request.name,
        "content": request.content,
        "created_at": created_at,
    }

    s3.put_object(
        Bucket=config.agent_storage_bucket_name,
        Key=key,
        Body=json.dumps(data, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )

    return AgentResponse(
        agent_id=agent_id,
        name=request.name,
        content=request.content,
        created_at=created_at,
    )


@router.delete("/{agent_id}")
def delete_agent(project_id: str, agent_id: str, x_user_id: str = Header(alias="x-user-id")) -> dict:
    """Delete an agent."""
    config = get_config()
    s3 = get_s3_client()

    key = _get_agent_key(x_user_id, project_id, agent_id)

    try:
        s3.head_object(Bucket=config.agent_storage_bucket_name, Key=key)
    except s3.exceptions.ClientError as e:
        if e.response["Error"]["Code"] == "404":
            raise HTTPException(status_code=404, detail="Agent not found") from e
        raise

    s3.delete_object(Bucket=config.agent_storage_bucket_name, Key=key)

    return {"message": f"Agent {agent_id} deleted"}
