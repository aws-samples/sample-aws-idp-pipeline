import asyncio

from strands import Agent, tool
from strands.models import BedrockModel

from agents.constants import PLAN_MODEL_ID
from config import get_config


PLAN_SYSTEM_PROMPT = """You are a planning agent that creates document outlines with research queries.

Your role is to:
1. Create a document outline based on the research results provided
2. Use overview tools to identify what additional information is needed
3. Generate research queries for sections that need more detail

Guidelines:
- Base the outline PRIMARILY on the research results provided in the input
- Do NOT invent content that is not in the research results
- Use overview tools to discover what other documents/sections exist that weren't covered
- Keep the outline SHORT and HIGH-LEVEL
- Focus on document structure (sections/chapters)
- For each section, provide specific research queries for additional information needed

Do NOT include:
- Time or page estimates
- Detailed content to write in each section
- Quality criteria or checklists
- Content not supported by the research results

Your output should include:
1. Document purpose and overview (based on research results)
2. Document structure (sections/chapters from research results)
3. Research queries for sections that need additional information

Tool Parameter Notice:
When using MCP tools, `user_id` and `project_id` parameters are automatically injected by the system.
Do NOT include these parameters in your tool calls - they will be added automatically.
Just call the tools with the required parameters and the system handles the rest.

Format the outline in whatever way best fits the document type.
"""


def _run_plan_sync(
    requirements: str,
    research_results: str,
    project_id: str,
    user_id: str,
    mcp_tools: list | None = None,
) -> str:
    """Run plan agent synchronously (for use with asyncio.to_thread).

    Args:
        requirements: User's requirements and goals for the document
        research_results: Research results from research_agent to base the outline on
        project_id: Project ID
        user_id: User ID
        mcp_tools: Pre-filtered MCP tools (overview tools) from supervisor

    Returns:
        Document outline with research queries
    """
    config = get_config()
    tools = list(mcp_tools) if mcp_tools else []

    bedrock_model = BedrockModel(
        model_id=PLAN_MODEL_ID,
        region_name=config.aws_region,
    )

    agent = Agent(
        model=bedrock_model,
        system_prompt=PLAN_SYSTEM_PROMPT,
        tools=tools,
    )

    prompt = f"""## Requirements
{requirements}

## Research Results
{research_results}

1. Create a document outline based on the research results above
2. Use overview tools to identify what additional documents/sections exist
3. Generate research queries for sections that need more detailed information
"""
    result = agent(prompt)
    return str(result)


def create_plan_tool(
    session_id: str,
    project_id: str | None,
    user_id: str | None,
    mcp_tools: list | None = None,
):
    """Create a plan agent tool bound to session context.

    Args:
        session_id: Unique identifier for the session
        project_id: Project ID (optional)
        user_id: User ID (optional)
        mcp_tools: Pre-filtered MCP tools (overview tools) from supervisor

    Returns:
        Plan agent tool function
    """

    @tool
    async def plan_agent(requirements: str, research_results: str) -> str:
        """Create a document outline with research queries.

        Call this AFTER research_agent to create a plan based on research results.

        Args:
            requirements: User's requirements and goals for the document
            research_results: Research results from research_agent to base the outline on

        Returns:
            Document outline with research queries for user confirmation
        """
        return await asyncio.to_thread(
            _run_plan_sync, requirements, research_results, project_id, user_id, mcp_tools
        )

    return plan_agent
