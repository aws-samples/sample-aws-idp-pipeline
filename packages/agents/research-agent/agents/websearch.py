from strands import Agent, tool
from strands.models import BedrockModel

from agents.constants import RESEARCH_MODEL_ID
from config import get_config

WEBSEARCH_SYSTEM_PROMPT = """You are a web search agent specialized in finding supplementary information from the web.

Your role is to:
1. Search the web using the WebSearch tool to find relevant information
2. Provide supplementary context and background information
3. Clearly mark all information as web-sourced

## Guidelines
- Focus on finding definitions, background context, and supplementary information
- Keep queries concise (under 200 characters) for the best results
- Always cite web sources with their URLs
- Note the publication date of a source when available
- Present information concisely
- Call tools immediately without asking for additional information
"""


async def _run_websearch_async(query: str, mcp_tools: list) -> str:
    """Run websearch agent asynchronously."""
    config = get_config()

    bedrock_model = BedrockModel(
        model_id=RESEARCH_MODEL_ID,
        region_name=config.aws_region,
    )

    agent = Agent(
        model=bedrock_model,
        system_prompt=WEBSEARCH_SYSTEM_PROMPT,
        tools=mcp_tools,
    )

    result = await agent.invoke_async(query)
    return str(result)


def create_websearch_tool(mcp_tools: list | None = None):
    """Create a websearch agent tool backed by the AgentCore WebSearch tool.

    Args:
        mcp_tools: Gateway WebSearch tool(s) shared from the supervisor's MCP client.
    """
    tools = mcp_tools or []

    @tool
    async def websearch_agent(query: str) -> str:
        """Search the web for supplementary information.

        Use this tool to find additional context from the web.
        This should only be used AFTER the plan is confirmed.

        Args:
            query: The search query

        Returns:
            Web search results
        """
        if not tools:
            return "Web search is not available: the WebSearch tool is not configured."
        return await _run_websearch_async(query, tools)

    return websearch_agent
