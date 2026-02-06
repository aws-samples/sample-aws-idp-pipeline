"""Tool registry for Nova Sonic voice agent."""

import json
import logging
import os
import sys
from datetime import datetime
from functools import wraps
from typing import Any, Callable, Coroutine
from urllib.parse import urlencode

import boto3
import pytz
import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

from strands.types.tools import ToolSpec, ToolResult

# Configure logging for this module
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
    force=True,
)
logger = logging.getLogger(__name__)


def get_backend_url() -> str:
    """Get backend URL from environment variable."""
    url = os.environ.get("BACKEND_URL", "")
    if not url:
        raise ValueError("BACKEND_URL environment variable is not set")
    return url.rstrip("/")


def signed_request(method: str, url: str, region: str = "us-east-1") -> requests.Response:
    """Make a SigV4 signed request to API Gateway."""
    session = boto3.Session()
    credentials = session.get_credentials().get_frozen_credentials()

    # Create and sign the request
    aws_request = AWSRequest(method=method, url=url)
    SigV4Auth(credentials, "execute-api", region).add_auth(aws_request)

    # Make the request with signed headers
    return requests.request(
        method=method,
        url=url,
        headers=dict(aws_request.headers),
        timeout=30,
    )

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


@tool(
    name="searchDocuments",
    description="Search through the user's uploaded documents using hybrid search (vector similarity + keyword matching). Use this when the user asks questions about their documents, wants to find specific information, or needs to retrieve content from their files.",
    input_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to find relevant documents. Be specific and use keywords from the user's question.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of results to return (default: 5, max: 20)",
            },
        },
        "required": ["query"],
    },
)
async def search_documents(tool_input: dict, context: dict) -> dict:
    """Search documents using hybrid search API."""
    query = tool_input.get("query", "")
    limit = min(tool_input.get("limit", 5), 20)
    project_id = context.get("project_id")

    print(f"[searchDocuments] query={query}, project_id={project_id}, limit={limit}", flush=True)
    logger.info(f"[searchDocuments] query={query}, project_id={project_id}, limit={limit}")

    if not project_id:
        print("[searchDocuments] ERROR: No project context", flush=True)
        return {
            "error": "No project context available",
            "results": [],
        }

    if not query:
        print("[searchDocuments] ERROR: No query", flush=True)
        return {
            "error": "Search query is required",
            "results": [],
        }

    try:
        backend_url = get_backend_url()
        params = {"query": query, "limit": str(limit)}
        query_string = urlencode(params)
        url = f"{backend_url}/projects/{project_id}/search/hybrid?{query_string}"

        print(f"[searchDocuments] Calling {url}", flush=True)
        logger.info(f"[searchDocuments] Calling {url}")

        # Make SigV4 signed request
        region = os.environ.get("AWS_REGION", "us-east-1")
        response = signed_request("GET", url, region)

        print(f"[searchDocuments] Response status: {response.status_code}", flush=True)
        response.raise_for_status()
        data = response.json()

        results = data.get("results", [])
        print(f"[searchDocuments] Got {len(results)} results", flush=True)
        logger.info(f"[searchDocuments] Got {len(results)} results")

        # Format results for voice response
        formatted_results = []
        for r in results:
            formatted_results.append({
                "content": r.get("content", "")[:500],  # Truncate for voice
                "score": r.get("score", 0),
                "segment_index": r.get("segment_index"),
            })

        return {
            "total_found": len(results),
            "results": formatted_results,
        }

    except requests.HTTPError as e:
        print(f"[searchDocuments] HTTP error: {e.response.status_code}", flush=True)
        logger.error(f"HTTP error during search: {e}")
        return {
            "error": f"Search failed: {e.response.status_code}",
            "results": [],
        }
    except Exception as e:
        print(f"[searchDocuments] Exception: {e}", flush=True)
        logger.exception(f"Search error: {e}")
        return {
            "error": f"Search failed: {str(e)}",
            "results": [],
        }
