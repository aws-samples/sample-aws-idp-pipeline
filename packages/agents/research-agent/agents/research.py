from strands import Agent, tool
from strands.models import BedrockModel

from agents.constants import RESEARCH_MODEL_ID
from config import get_config

RESEARCH_SYSTEM_PROMPT = """You are a research agent specialized in gathering detailed information from documents.

Your role is to:
1. Use summarize tools to gather detailed information from documents
2. Execute research queries provided by the plan
3. Organize and present the collected information clearly

## Guidelines
- Focus on extracting information from documents using summarize tools
- Include source references when presenting information
- Call tools immediately without asking for additional information

Tool Parameter Notice:
When using MCP tools, `user_id` and `project_id` parameters are automatically injected by the system.
Do NOT include these parameters in your tool calls - they will be added automatically.
"""


async def _run_research_async(
    session_id: str,
    project_id: str,
    user_id: str,
    query: str,
    mcp_tools: list | None = None,
) -> str:
    """Run research agent asynchronously.

    Args:
        session_id: Unique identifier for the session
        project_id: Project ID
        user_id: User ID
        query: The research query
        mcp_tools: Pre-filtered MCP tools from supervisor (optional)

    Returns:
        Research result as string
    """
    config = get_config()
    tools = list(mcp_tools) if mcp_tools else []

    bedrock_model = BedrockModel(
        model_id=RESEARCH_MODEL_ID,
        region_name=config.aws_region,
    )

    print("run search: ", project_id, user_id)
    print("research tools: ", [t.tool_name for t in tools] if tools else "no tools")

    agent = Agent(
        model=bedrock_model,
        system_prompt=RESEARCH_SYSTEM_PROMPT,
        tools=tools,
    )

    result = await agent.invoke_async(query)
    return str(result)


def create_research_tool(
    session_id: str,
    project_id: str,
    user_id: str,
    mcp_tools: list | None = None,
):
    """Create a research agent tool bound to session context.

    Args:
        session_id: Unique identifier for the session
        project_id: Project ID
        user_id: User ID
        mcp_tools: Pre-filtered MCP tools from supervisor (optional)

    Returns:
        Research agent tool function
    """

    @tool
    async def research_agent(query: str) -> str:
        """Search documents and gather information for the given query.

        Use this tool to:
        - Search for relevant documents
        - Read artifacts and gather context
        - Collect information before creating a plan

        Args:
            query: The research query describing what information to gather

        Returns:
            Research findings and gathered information
        """
        return await _run_research_async(
            session_id, project_id, user_id, query, mcp_tools=mcp_tools
        )

    return research_agent
