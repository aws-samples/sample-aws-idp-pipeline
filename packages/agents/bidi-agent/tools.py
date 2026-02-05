"""Tool registry for Nova Sonic voice agent."""

import json
import logging
from datetime import datetime
from functools import wraps
from typing import Any, Callable, Coroutine

import pytz

from strands.types.tools import ToolSpec, ToolResult

logger = logging.getLogger(__name__)

# Tool registry: name -> {"func": callable, "spec": ToolSpec}
TOOL_REGISTRY: dict[str, dict[str, Any]] = {}


def tool(name: str, description: str, input_schema: dict):
    """Decorator to register a tool.

    Usage:
        @tool(
            name="myTool",
            description="Does something useful",
            input_schema={
                "type": "object",
                "properties": {
                    "param1": {"type": "string", "description": "..."}
                },
                "required": ["param1"]
            }
        )
        async def my_tool(tool_input: dict, context: dict) -> dict:
            # tool_input: parsed input from the model
            # context: {"timezone": "Asia/Seoul", ...}
            return {"result": "..."}
    """

    def decorator(
        func: Callable[[dict, dict], Coroutine[Any, Any, dict]],
    ) -> Callable[[dict, dict], Coroutine[Any, Any, dict]]:
        TOOL_REGISTRY[name] = {
            "func": func,
            "spec": {
                "name": name,
                "description": description,
                "inputSchema": input_schema,
            },
        }

        @wraps(func)
        async def wrapper(tool_input: dict, context: dict) -> dict:
            return await func(tool_input, context)

        return wrapper

    return decorator


def get_tools() -> list[ToolSpec]:
    """Get all registered tool specifications."""
    return [t["spec"] for t in TOOL_REGISTRY.values()]


async def execute_tool(tool_use: dict, context: dict) -> ToolResult:
    """Execute a tool and return the result.

    Args:
        tool_use: Tool use request from the model
            - name: Tool name
            - input: Tool input parameters
            - toolUseId: Unique identifier for this tool use
        context: Execution context
            - timezone: User's timezone (IANA format)

    Returns:
        ToolResult with status and content
    """
    tool_name = tool_use.get("name", "")
    tool_input = tool_use.get("input", {}) or {}
    tool_use_id = tool_use.get("toolUseId", "")

    logger.info(f"Executing tool: {tool_name} with input: {tool_input}")

    if tool_name not in TOOL_REGISTRY:
        logger.warning(f"Unknown tool: {tool_name}")
        return {
            "toolUseId": tool_use_id,
            "status": "error",
            "content": [{"text": f"Unknown tool: {tool_name}"}],
        }

    try:
        result = await TOOL_REGISTRY[tool_name]["func"](tool_input, context)
        return {
            "toolUseId": tool_use_id,
            "status": "success",
            "content": [{"text": json.dumps(result)}],
        }
    except Exception as e:
        logger.exception(f"Tool execution failed: {tool_name}")
        return {
            "toolUseId": tool_use_id,
            "status": "error",
            "content": [{"text": f"Tool execution failed: {str(e)}"}],
        }


# =============================================================================
# Tool Implementations
# =============================================================================


@tool(
    name="getDateAndTimeTool",
    description="Get the current date and time. Use this when the user asks about the current time, date, day of week, or any time-related questions.",
    input_schema={
        "type": "object",
        "properties": {
            "timezone": {
                "type": "string",
                "description": "IANA timezone name (e.g., 'Asia/Seoul', 'America/New_York', 'UTC'). Use the user's timezone if known.",
            }
        },
        "required": [],
    },
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
