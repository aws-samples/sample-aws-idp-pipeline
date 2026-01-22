from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.config import get_config
from app.s3 import get_s3_client

router = APIRouter(prefix="/projects/{project_id}/agents", tags=["agents"])


class AgentUpdate(BaseModel):
    content: str


class AgentResponse(BaseModel):
    name: str
    content: str
    updated_at: str


class AgentListItem(BaseModel):
    name: str
    updated_at: str


def _get_agents_prefix(user_id: str, project_id: str) -> str:
    """Get S3 prefix for all agents in a project."""
    return f"{user_id}/{project_id}/agents/"


def _get_agent_key(user_id: str, project_id: str, agent_name: str) -> str:
    """Get S3 key for an agent."""
    return f"{_get_agents_prefix(user_id, project_id)}{agent_name}.md"


@router.get("")
def list_agents(project_id: str, x_user_id: str = Header(alias="x-user-id")) -> list[AgentListItem]:
    """List all agents for a user's project."""
    config = get_config()
    s3 = get_s3_client()

    prefix = _get_agents_prefix(x_user_id, project_id)
    response = s3.list_objects_v2(Bucket=config.agent_storage_bucket_name, Prefix=prefix)

    agents = []
    for obj in response.get("Contents", []):
        key = obj["Key"]
        if key.endswith(".md"):
            name = key.rsplit("/", 1)[-1].replace(".md", "")
            agents.append(
                AgentListItem(
                    name=name,
                    updated_at=obj["LastModified"].isoformat(),
                )
            )

    return agents


@router.get("/{agent_name}")
def get_agent(project_id: str, agent_name: str, x_user_id: str = Header(alias="x-user-id")) -> AgentResponse:
    """Get a specific agent by name."""
    config = get_config()
    s3 = get_s3_client()

    key = _get_agent_key(x_user_id, project_id, agent_name)

    try:
        response = s3.get_object(Bucket=config.agent_storage_bucket_name, Key=key)
        content = response["Body"].read().decode("utf-8")
        last_modified = response["LastModified"].isoformat()

        return AgentResponse(
            name=agent_name,
            content=content,
            updated_at=last_modified,
        )
    except s3.exceptions.NoSuchKey:
        raise HTTPException(status_code=404, detail="Agent not found")


@router.put("/{agent_name}")
def upsert_agent(project_id: str, agent_name: str, request: AgentUpdate, x_user_id: str = Header(alias="x-user-id")) -> AgentResponse:
    """Create or update an agent (upsert)."""
    config = get_config()
    s3 = get_s3_client()

    key = _get_agent_key(x_user_id, project_id, agent_name)

    now = datetime.now(timezone.utc).isoformat()
    s3.put_object(
        Bucket=config.agent_storage_bucket_name,
        Key=key,
        Body=request.content.encode("utf-8"),
        ContentType="text/markdown",
    )

    return AgentResponse(
        name=agent_name,
        content=request.content,
        updated_at=now,
    )


@router.delete("/{agent_name}")
def delete_agent(project_id: str, agent_name: str, x_user_id: str = Header(alias="x-user-id")) -> dict:
    """Delete an agent."""
    config = get_config()
    s3 = get_s3_client()

    key = _get_agent_key(x_user_id, project_id, agent_name)

    # Check if agent exists
    try:
        s3.head_object(Bucket=config.agent_storage_bucket_name, Key=key)
    except s3.exceptions.ClientError as e:
        if e.response["Error"]["Code"] == "404":
            raise HTTPException(status_code=404, detail="Agent not found")
        raise

    # Delete the agent
    s3.delete_object(Bucket=config.agent_storage_bucket_name, Key=key)

    return {"message": f"Agent {agent_name} deleted"}
