"""MCP client and tools configuration for bidi-agent."""

import logging
from datetime import datetime

import boto3
import pytz
from strands.tools.mcp.mcp_client import MCPClient

from agentcore_mcp_client import AgentCoreGatewayMCPClient
from config import get_config

logger = logging.getLogger(__name__)


def get_mcp_client() -> MCPClient | None:
    """Get MCP client for AgentCore Gateway."""
    config = get_config()
    if not config.mcp_gateway_url:
        logger.warning("MCP_GATEWAY_URL not configured, MCP tools will not be available")
        return None

    session = boto3.Session()
    credentials = session.get_credentials()

    return AgentCoreGatewayMCPClient.with_iam_auth(
        gateway_url=config.mcp_gateway_url,
        credentials=credentials,
        region=config.aws_region,
    )


async def get_date_and_time(tool_input: dict, context: dict) -> dict:
    """Get the current date and time in the specified timezone."""
    tz_name = tool_input.get("timezone") or context.get("timezone") or "UTC"

    try:
        tz = pytz.timezone(tz_name)
    except Exception:
        tz = pytz.UTC
        tz_name = "UTC"

    now = datetime.now(tz)

    return {
        "currentTime": now.strftime("%H:%M:%S"),
        "formattedTime": now.strftime("%I:%M %p"),
        "date": now.strftime("%Y-%m-%d"),
        "year": now.year,
        "month": now.month,
        "day": now.day,
        "dayOfWeek": now.strftime("%A"),
        "timezone": tz_name,
    }


# Built-in tools that don't require MCP
BUILTIN_TOOLS = [
    {
        "name": "getDateAndTimeTool",
        "description": "Get the current date and time. Use this when the user asks about the current time, date, day of week, or any time-related questions.",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "timezone": {
                        "type": "string",
                        "description": "IANA timezone name (e.g., 'Asia/Seoul', 'America/New_York', 'UTC'). Use the user's timezone if known.",
                    }
                },
                "required": [],
            }
        },
    },
]


def get_tools() -> list[dict]:
    """Get all tool specifications (built-in only, MCP tools are added dynamically)."""
    return BUILTIN_TOOLS.copy()


TOOL_HANDLERS = {
    "getDateAndTimeTool": get_date_and_time,
}


async def execute_builtin_tool(tool_name: str, tool_input: dict, context: dict) -> dict | None:
    """Execute a built-in tool if it exists."""
    handler = TOOL_HANDLERS.get(tool_name)
    if handler:
        return await handler(tool_input, context)
    return None
