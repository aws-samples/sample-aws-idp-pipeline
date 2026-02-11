"""Common MCP client utilities."""

import boto3

from strands.tools.mcp import MCPAgentTool
from strands.types.tools import ToolSpec

from agents.agentcore_mcp_client import AgentCoreGatewayMCPClient
from config import get_config


class AutoInjectedMCPTool(MCPAgentTool):
    """MCP tool wrapper that auto-injects user_id and project_id."""

    def __init__(self, mcp_tool, mcp_client, user_id: str, project_id: str):
        super().__init__(mcp_tool, mcp_client)
        self.user_id = user_id
        self.project_id = project_id

    @property
    def tool_spec(self) -> ToolSpec:
        spec = super().tool_spec
        input_schema = spec["inputSchema"]["json"]
        if "properties" in input_schema:
            input_schema["properties"].pop("user_id", None)
            input_schema["properties"].pop("project_id", None)
        if "required" in input_schema:
            input_schema["required"] = [
                p for p in input_schema["required"]
                if p not in ("user_id", "project_id")
            ]
        return spec

    async def stream(self, tool_use, invocation_state, **kwargs):
        tool_use["input"]["user_id"] = self.user_id
        tool_use["input"]["project_id"] = self.project_id
        async for event in super().stream(tool_use, invocation_state, **kwargs):
            yield event


def wrap_mcp_tools(mcp_tools: list, user_id: str, project_id: str) -> list:
    """Wrap MCP tools to auto-inject user_id and project_id.

    Args:
        mcp_tools: List of MCP tools to wrap
        user_id: User ID to inject
        project_id: Project ID to inject

    Returns:
        List of wrapped MCP tools
    """
    return [
        AutoInjectedMCPTool(t.mcp_tool, t.mcp_client, user_id, project_id)
        for t in mcp_tools
    ]


def get_mcp_client() -> AgentCoreGatewayMCPClient | None:
    """Get MCP client for AgentCore Gateway.

    Returns:
        MCP client instance or None if gateway URL is not configured.
    """
    config = get_config()
    if not config.mcp_gateway_url:
        return None

    session = boto3.Session()
    credentials = session.get_credentials()

    return AgentCoreGatewayMCPClient.with_iam_auth(
        gateway_url=config.mcp_gateway_url,
        credentials=credentials,
        region=config.aws_region,
    )


def filter_tools_by_keyword(tools: list, keyword: str) -> list:
    """Filter tools by keyword in tool name.

    Args:
        tools: List of MCP tools
        keyword: Keyword to filter by

    Returns:
        Filtered list of tools containing the keyword in their name.
    """
    return [t for t in tools if keyword in t.tool_name]
