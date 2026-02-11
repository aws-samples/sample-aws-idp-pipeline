from contextlib import ExitStack, contextmanager

from strands import Agent
from strands.models import BedrockModel
from strands.session import S3SessionManager
from strands_tools import current_time, handoff_to_user, http_request

from agents.constants import SUPERVISOR_MODEL_ID
from agents.mcp import filter_tools_by_keyword, get_mcp_client, wrap_mcp_tools
from agents.plan import create_plan_tool
from agents.pptx import create_pptx_tool
from agents.research import create_research_tool
from agents.websearch import create_websearch_tool
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
    with ExitStack() as stack:
        # Open MCP client once and share filtered tools with sub-agents
        mcp_client = get_mcp_client()
        overview_tools = []
        summarize_tools = []
        image_tools = []

        if mcp_client:
            stack.enter_context(mcp_client)
            mcp_tools = mcp_client.list_tools_sync()
            print("mcp tools: ", [t.tool_name for t in mcp_tools])
            overview_tools = wrap_mcp_tools(
                filter_tools_by_keyword(mcp_tools, "overview"),
                user_id, project_id
            )
            summarize_tools = wrap_mcp_tools(
                filter_tools_by_keyword(mcp_tools, "summarize"),
                user_id, project_id
            )
            image_tools = wrap_mcp_tools(
                filter_tools_by_keyword(mcp_tools, "image"),
                user_id, project_id
            )

        plan_tool = create_plan_tool(
            session_id, project_id, user_id, mcp_tools=overview_tools
        )
        research_tool = create_research_tool(
            session_id, project_id, user_id, mcp_tools=summarize_tools
        )
        websearch_tool = create_websearch_tool()
        write_tool = create_write_tool(session_id, project_id, user_id)
        pptx_tool = create_pptx_tool(
            session_id, project_id, user_id, mcp_tools=image_tools
        )

        tools = [
            current_time,
            http_request,
            handoff_to_user,
            research_tool,
            websearch_tool,
            plan_tool,
            write_tool,
            pptx_tool,
        ]

        system_prompt = """You are IDP Research Agent, an intelligent document processing assistant that helps users create professional presentations.

You coordinate planning, research, writing, and document creation tasks.

## Workflow (MUST follow in order)

1. Call research_agent FIRST to gather initial document information (documents only)
2. Call plan_agent with the research results to:
   - Create a document outline based on the research results
   - Use overview tools to identify what additional information is needed
   - Generate research queries for sections that need more detail
3. Use handoff_to_user to present the plan and get user confirmation
4. After user confirms, call BOTH research_agent AND websearch_agent:
   - research_agent: for additional document details using research queries from the plan
   - websearch_agent: for supplementary web information (definitions, background context)
5. Call write_agent with the plan AND all research results (documents + web)
6. Call pptx_agent to create the PowerPoint presentation from the written content

## IMPORTANT
- Call research_agent FIRST to get actual document content
- Pass the research results to plan_agent so the outline is based on real document content
- Do NOT use websearch_agent before the plan is confirmed (steps 1-3)
- You MUST use handoff_to_user after plan_agent completes to get user confirmation
- Do NOT proceed without user confirmation
- MUST call research_agent AGAIN after user confirmation (step 4) before calling write_agent
- websearch_agent should ONLY be used in step 4 for supplementary information
- NEVER skip the second research_agent call - write_agent needs the detailed research
- write_agent creates the content, pptx_agent converts it to PowerPoint

## Available Tools

### research_agent
Gather information from documents using summarize tools.
- Call FIRST (step 1) to get initial document content before planning
- Call AGAIN (step 4) after user confirms the plan, using the research queries from plan_agent
- The second call is REQUIRED before write_agent can be called
- This tool searches ONLY documents, not the web

### websearch_agent
Search the web for supplementary information.
- ONLY use AFTER the plan is confirmed (step 4)
- Provides definitions, background context, and supplementary information
- Web search results should complement document information, not replace it
- Do NOT use before plan confirmation

### plan_agent
Create a document outline based on research results.
- Pass the research results from research_agent
- Uses overview tools to identify gaps and generate additional research queries
- The outline should be based primarily on the research results

### handoff_to_user
Request user confirmation or input.
- MUST use breakout_of_loop=True to stop and wait for user response
- Present the plan clearly and ask for confirmation
- Session will be saved and resumed when user responds

### write_agent
Write detailed content based on the plan and research.
- ONLY call AFTER research_agent has gathered additional details (step 4)
- Pass the confirmed plan AND the research results from step 4
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
