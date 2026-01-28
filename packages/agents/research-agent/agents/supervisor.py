from contextlib import contextmanager

from strands import Agent
from strands.models import BedrockModel
from strands.session import S3SessionManager
from strands_tools import current_time, http_request

from agents.constants import SUPERVISOR_MODEL_ID
from config import get_config


def get_session_manager(
    session_id: str,
    user_id: str | None = None,
    project_id: str | None = None,
) -> S3SessionManager:
    """Get S3SessionManager instance for a session."""
    config = get_config()

    prefix_parts = ["sessions"]
    if user_id:
        prefix_parts.append(user_id)
    if project_id:
        prefix_parts.append(project_id)

    return S3SessionManager(
        session_id=session_id,
        bucket=config.session_storage_bucket_name,
        prefix="/".join(prefix_parts),
    )


@contextmanager
def get_supervisor_agent(
    session_id: str,
    project_id: str | None = None,
    user_id: str | None = None,
):
    """Get a supervisor agent instance with S3-based session management.

    The supervisor agent coordinates specialist agents and delegates tasks.

    Args:
        session_id: Unique identifier for the session
        project_id: Project ID (optional)
        user_id: User ID for session isolation (optional)

    Yields:
        Supervisor agent instance with session management configured
    """
    session_manager = get_session_manager(
        session_id, user_id=user_id, project_id=project_id
    )

    tools = [current_time, http_request]

    system_prompt = """You are a supervisor agent that coordinates and delegates tasks to specialist agents.

Your role is to:
1. Understand the user's request and break it down into subtasks if needed
2. Delegate tasks to the appropriate specialist agents
3. Integrate results from specialist agents into a coherent response
4. Provide clear and helpful responses to the user

When delegating tasks, choose the most appropriate specialist agent based on the task requirements.
"""

    config = get_config()
    bedrock_model = BedrockModel(
        model_id=SUPERVISOR_MODEL_ID,
        region_name=config.aws_region,
    )

    agent = Agent(
        model=bedrock_model,
        system_prompt=system_prompt,
        tools=tools,
        session_manager=session_manager,
    )

    yield agent
