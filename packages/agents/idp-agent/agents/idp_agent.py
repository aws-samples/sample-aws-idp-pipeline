from contextlib import contextmanager, ExitStack
import boto3
from strands.tools.mcp.mcp_client import MCPClient
from mcp import StdioServerParameters, stdio_client
from strands import Agent
from strands.hooks.registry import HookProvider
from strands.models import BedrockModel
from strands.session import S3SessionManager
from strands_tools import calculator, current_time, generate_image, http_request

from agentcore_mcp_client import AgentCoreGatewayMCPClient
from config import get_config
from helpers import get_project_language
from prompts import DEFAULT_SYSTEM_PROMPT, fetch_custom_agent_prompt, fetch_system_prompt

from .image_artifact_saver_hook import ImageArtifactSaverHook
from .tool_parameter_enforcer_hook import ToolParameterEnforcerHook


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


def get_mcp_client():
    """Get MCP client for AgentCore Gateway."""
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


def get_duckduckgo_mcp_client():
    """Get MCP client for DuckDuckGo search server."""

    return MCPClient(
        lambda: stdio_client(
            StdioServerParameters(
                command="duckduckgo-mcp-server",
            )
        )
    )


@contextmanager
def get_agent(
    session_id: str,
    project_id: str | None = None,
    user_id: str | None = None,
    agent_id: str | None = None,
):
    """Get an agent instance with S3-based session management.

    Args:
        session_id: Unique identifier for the session
        project_id: Project ID for document search (optional for init)
        user_id: User ID for session isolation (optional)
        agent_id: Custom agent ID for prompt injection (optional)

    Yields:
        Agent instance with session management configured
    """
    session_manager = get_session_manager(session_id, user_id=user_id, project_id=project_id)
    mcp_client = get_mcp_client()
    duckduckgo_client = get_duckduckgo_mcp_client()

    tools = [calculator, current_time, generate_image, http_request]

    config = get_config()
    if config.is_agentcore:
        from strands_tools import code_interpreter

        tools.append(code_interpreter)

    system_prompt = fetch_system_prompt() or DEFAULT_SYSTEM_PROMPT

    if agent_id and user_id and project_id:
        custom_prompt = fetch_custom_agent_prompt(user_id, project_id, agent_id)
        if custom_prompt:
            system_prompt += f"""

## Custom Instructions
{custom_prompt}
"""

    if project_id:
        language_code = get_project_language(project_id) or "en"

        system_prompt += f"""
You MUST respond in the language corresponding to code: {language_code}.
"""

    system_prompt += """
## Tool Parameter Notice
When using MCP tools, `user_id` and `project_id` parameters are automatically injected by the system.
You MUST NOT specify these parameters in tool calls - they will be overwritten by the system for security.

## Web Search Guidelines (MANDATORY)
When performing web searches, you MUST follow these rules strictly:
1. Search with max_results of 10 to get diverse sources
2. You MUST call fetch_content on AT LEAST 3 different URLs - this is a hard requirement, not optional
3. If a website returns an error (403, timeout, etc.), try another URL until you have successfully fetched 3+ pages
4. Do NOT stop after fetching only 1-2 websites - always continue until you have 3+ successful fetches
5. Synthesize information from all fetched sources before responding
6. Always cite the sources you used with their URLs
"""

    bedrock_model = BedrockModel(
        model_id=config.bedrock_model_id,
        region_name=config.aws_region,
    )

    hooks: list[HookProvider] = [
        ToolParameterEnforcerHook(user_id=user_id, project_id=project_id),
        ImageArtifactSaverHook(user_id=user_id, project_id=project_id),
    ]

    def create_agent():
        return Agent(
            model=bedrock_model,
            system_prompt=system_prompt,
            tools=tools,
            hooks=hooks,
            session_manager=session_manager,
            agent_id=agent_id or "default",
        )

    with ExitStack() as stack:
        if duckduckgo_client:
            stack.enter_context(duckduckgo_client)
            tools.extend(duckduckgo_client.list_tools_sync())

        if mcp_client:
            stack.enter_context(mcp_client)
            tools.extend(mcp_client.list_tools_sync())

        yield create_agent()
