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


def signed_request(
    method: str,
    url: str,
    region: str = "us-east-1",
    service: str = "execute-api",
    body: bytes | None = None,
    extra_headers: dict | None = None,
    timeout: int = 30,
) -> requests.Response:
    """Make a SigV4 signed request."""
    session = boto3.Session()
    credentials = session.get_credentials().get_frozen_credentials()

    headers = extra_headers or {}

    # Create and sign the request
    aws_request = AWSRequest(method=method, url=url, data=body, headers=headers)
    SigV4Auth(credentials, service, region).add_auth(aws_request)

    # Make the request with signed headers
    return requests.request(
        method=method,
        url=url,
        data=body,
        headers=dict(aws_request.headers),
        timeout=timeout,
    )


# Tool registry: name -> {"func": callable, "spec": ToolSpec}
TOOL_REGISTRY: dict[str, dict[str, Any]] = {}


def tool(name: str, description: str, input_schema: dict):
    """Decorator to register a tool."""

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
    """Execute a tool and return the result."""
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
    description="Search through the user's uploaded documents. Use this when the user asks questions about their documents or wants to find specific information.",
    input_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to find relevant documents.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of results to return (default: 3)",
            },
        },
        "required": ["query"],
    },
)
async def search_documents(tool_input: dict, context: dict) -> dict:
    """Search documents using hybrid search API."""
    query = tool_input.get("query", "")
    limit = min(tool_input.get("limit", 3), 10)
    project_id = context.get("project_id")

    logger.info(f"[searchDocuments] query={query}, project_id={project_id}, limit={limit}")

    if not project_id:
        return {"error": "No project context available", "results": []}

    if not query:
        return {"error": "Search query is required", "results": []}

    try:
        backend_url = get_backend_url()
        params = {"query": query, "limit": str(limit)}
        query_string = urlencode(params)
        url = f"{backend_url}/projects/{project_id}/search/hybrid?{query_string}"

        logger.info(f"[searchDocuments] Calling {url}")

        region = os.environ.get("AWS_REGION", "us-east-1")
        response = signed_request("GET", url, region)

        logger.info(f"[searchDocuments] Response status: {response.status_code}")
        response.raise_for_status()
        data = response.json()

        results = data.get("results", [])
        logger.info(f"[searchDocuments] Got {len(results)} results")

        # Format results for voice - keep it brief
        formatted_results = []
        for r in results[:3]:  # Max 3 results for voice
            content = r.get("content", "")[:300]  # Truncate for voice
            formatted_results.append({"content": content})

        return {
            "total_found": len(results),
            "results": formatted_results,
        }

    except requests.HTTPError as e:
        logger.error(f"HTTP error during search: {e}")
        return {"error": f"Search failed: {e.response.status_code}", "results": []}
    except Exception as e:
        logger.exception(f"Search error: {e}")
        return {"error": f"Search failed: {str(e)}", "results": []}
