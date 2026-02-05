from contextlib import contextmanager

from strands import Agent
from strands.models import BedrockModel
from strands.session import S3SessionManager
from strands_tools import current_time, handoff_to_user, http_request

from agents.constants import SUPERVISOR_MODEL_ID
from agents.plan import create_plan_tool
from agents.pptx import create_pptx_tool
from agents.research import create_research_tool
from agents.write import create_write_tool
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
    write_tool = create_write_tool(session_id, project_id, user_id)
    pptx_tool = create_pptx_tool(session_id, project_id, user_id)

    tools = [
        current_time,
        http_request,
        handoff_to_user,
        research_tool,
        plan_tool,
        write_tool,
        pptx_tool,
    ]

    system_prompt = """You are IDP Research Agent, an intelligent document processing assistant that helps users create professional presentations.

You coordinate research, planning, writing, and document creation tasks.

## Workflow (MUST follow in order)

1. Call research_agent to gather relevant information
2. Call plan_agent to create a document outline
3. Use handoff_to_user to present the plan and get user confirmation
4. After user confirms:
   a. Call research_agent again for detailed research on each section (if needed)
   b. Call write_agent to create detailed content based on the plan and research
5. Call pptx_agent to create the PowerPoint presentation from the written content

## IMPORTANT
- You MUST use handoff_to_user after plan_agent completes to get user confirmation
- Do NOT proceed without user confirmation
- After confirmation, gather additional research for each section before writing
- write_agent creates the content, pptx_agent converts it to PowerPoint

## Available Tools

### research_agent
Search documents and gather information.
- Pass a clear query describing what to find
- Call multiple times for different sections if needed

### plan_agent
Create a document outline based on research.
- Pass the research context and user's requirements

### handoff_to_user
Request user confirmation or input.
- MUST use breakout_of_loop=True to stop and wait for user response
- Present the plan clearly and ask for confirmation
- Session will be saved and resumed when user responds

### write_agent
Write detailed content based on the plan and research.
- Pass the confirmed plan and all gathered research
- Creates presentation-ready content for each section

### pptx_agent
Create PowerPoint presentation from written content.
- Pass the written content from write_agent
- Generates the final PPTX file
"""

    config = get_config()
    bedrock_model = BedrockModel(
        model_id=SUPERVISOR_MODEL_ID,
        region_name=config.aws_region,
    )

    session_manager = get_session_manager(
        session_id, user_id=user_id, project_id=project_id
    )

    agent = Agent(
        model=bedrock_model,
        system_prompt=system_prompt,
        tools=tools,
        session_manager=session_manager,
        agent_id="research",
    )

    yield agent
