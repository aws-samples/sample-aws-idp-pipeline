from mcp import StdioServerParameters, stdio_client
from strands import Agent, tool
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient

from agents.constants import RESEARCH_MODEL_ID
from config import get_config


def get_ddg_mcp_client() -> MCPClient:
    """Get DuckDuckGo MCP client for web search."""
    return MCPClient(
        lambda: stdio_client(
            StdioServerParameters(command="duckduckgo-mcp-server", args=[])
        )
    )


WEBSEARCH_SYSTEM_PROMPT = """You are a web search agent specialized in finding supplementary information from the web.

Your role is to:
1. Search the web using DuckDuckGo to find relevant information
2. Provide supplementary context and background information
3. Clearly mark all information as web-sourced

## Guidelines
- Focus on finding definitions, background context, and supplementary information
- Always cite web sources
- Present information concisely
- Call tools immediately without asking for additional information
"""


async def _run_websearch_async(query: str) -> str:
    """Run websearch agent asynchronously."""
    config = get_config()

    bedrock_model = BedrockModel(
        model_id=RESEARCH_MODEL_ID,
        region_name=config.aws_region,
    )

    ddg_client = get_ddg_mcp_client()
    with ddg_client:
        ddg_tools = ddg_client.list_tools_sync()

        agent = Agent(
            model=bedrock_model,
            system_prompt=WEBSEARCH_SYSTEM_PROMPT,
            tools=ddg_tools,
        )

        result = await agent.invoke_async(query)
        return str(result)


def create_websearch_tool():
    """Create a websearch agent tool."""

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
        return await _run_websearch_async(query)

    return websearch_agent
