from contextlib import ExitStack, contextmanager

import boto3
from botocore.config import Config as BotocoreConfig
from mcp import StdioServerParameters, stdio_client
from strands import Agent, AgentSkills
from strands.hooks.registry import HookProvider
from strands.models import BedrockModel
from strands.session import S3SessionManager
from strands.tools.mcp.mcp_client import MCPClient
from strands_tools import calculator, current_time, file_read, generate_image, http_request, shell, use_llm
from strands_tools.code_interpreter import AgentCoreCodeInterpreter

from agentcore_mcp_client import AgentCoreGatewayMCPClient
from config import get_config
from helpers import get_project_language
from prompts import build_system_prompt
from tools.artifact import create_artifact_path_tool

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

    config = get_config()

    interpreter = AgentCoreCodeInterpreter(
        region=config.aws_region,
        session_name=session_id,
        identifier=config.code_interpreter_identifier or None,
    )

    tools = [
        calculator,
        current_time,
        generate_image,
        http_request,
        file_read,
        shell,
        use_llm,
        interpreter.code_interpreter,
        create_artifact_path_tool(user_id, project_id),
    ]

    config = get_config()
    if config.is_agentcore:
        from strands_tools import code_interpreter

        tools.append(code_interpreter)

    language_code = get_project_language(project_id) if project_id else None
    system_prompt = build_system_prompt(
        project_id=project_id,
        user_id=user_id,
        agent_id=agent_id,
        language_code=language_code,
    )

    bedrock_model = BedrockModel(
        model_id=config.bedrock_model_id,
        region_name=config.aws_region,
        boto_client_config=BotocoreConfig(read_timeout=600),
    )

    hooks: list[HookProvider] = [
        ToolParameterEnforcerHook(user_id=user_id, project_id=project_id),
        ImageArtifactSaverHook(user_id=user_id, project_id=project_id),
    ]

    skills_plugin = AgentSkills(skills="./.skills/")

    def create_agent():
        return Agent(
            model=bedrock_model,
            system_prompt=system_prompt,
            tools=tools,
            hooks=hooks,
            plugins=[skills_plugin],
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
