from contextlib import contextmanager

from strands import Agent
from strands.models import BedrockModel
from strands_tools import current_time, http_request

from agents.constants import SUPERVISOR_MODEL_ID
from agents.plan import create_plan_tool
from agents.research import create_research_tool
from config import get_config


@contextmanager
def get_supervisor_agent(
    session_id: str,
    project_id: str | None = None,
    user_id: str | None = None,
):
    """Get a supervisor agent instance.

    The supervisor agent coordinates research and planning tasks.

    Args:
        session_id: Unique identifier for the session
        project_id: Project ID (optional)
        user_id: User ID for session isolation (optional)

    Yields:
        Supervisor agent instance configured
    """
    research_tool = create_research_tool(session_id, project_id, user_id)
    plan_tool = create_plan_tool(session_id, project_id, user_id)

    tools = [current_time, http_request, research_tool, plan_tool]

    system_prompt = """You are a supervisor agent that coordinates research and planning tasks.

## Workflow (MUST follow in order)

1. Call research_agent to gather relevant information
2. Call plan_agent to create a document outline
3. STOP and present the plan to user for confirmation

## IMPORTANT
- You MUST stop after plan_agent completes
- Do NOT proceed beyond planning
- Do NOT write or execute the actual document
- Just present the plan and wait for user confirmation

## Available Tools

### research_agent
Search documents and gather information.
- Pass a clear query describing what to find

### plan_agent
Create a document outline based on research.
- Pass the research context and user's requirements
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
    )

    yield agent
