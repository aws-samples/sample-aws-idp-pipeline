from contextlib import contextmanager

import boto3
from strands import Agent
from strands.hooks.events import BeforeToolCallEvent
from strands.hooks.registry import HookProvider, HookRegistry
from strands.models import BedrockModel
from strands.session import S3SessionManager
from strands_tools import calculator, current_time, generate_image, http_request

from agentcore_mcp_client import AgentCoreGatewayMCPClient
from config import get_config
from helpers import get_project_language
from prompts import DEFAULT_SYSTEM_PROMPT, fetch_custom_agent_prompt, fetch_system_prompt


class ToolParameterEnforcerHook(HookProvider):
    """Hook that enforces user_id and project_id parameters for specific tools."""

    def __init__(self, user_id: str | None = None, project_id: str | None = None):
        self.user_id = user_id
        self.project_id = project_id

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(BeforeToolCallEvent, self._enforce_parameters)

    def _enforce_parameters(self, event: BeforeToolCallEvent) -> None:
        if event.selected_tool is None:
            return

        tool_name = event.selected_tool.tool_name

        # MCP 툴인지 확인 (___로 구분)
        is_mcp_tool = "___" in tool_name

        if not is_mcp_tool:
            return

        # 모든 MCP 툴에 user_id, project_id 강제 주입
        if self.user_id:
            event.tool_use["input"]["user_id"] = self.user_id

        if self.project_id:
            event.tool_use["input"]["project_id"] = self.project_id


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
"""

    bedrock_model = BedrockModel(
        model_id=config.bedrock_model_id,
        region_name=config.aws_region,
    )

    hooks: list[HookProvider] = [ToolParameterEnforcerHook(user_id=user_id, project_id=project_id)]

    def create_agent():
        return Agent(
            model=bedrock_model,
            system_prompt=system_prompt,
            tools=tools,
            hooks=hooks,
            session_manager=session_manager,
            agent_id=agent_id or "default",
        )

    if mcp_client:
        with mcp_client:
            mcp_tools = mcp_client.list_tools_sync()
            tools.extend(mcp_tools)
            yield create_agent()
    else:
        yield create_agent()
