from contextlib import contextmanager

import boto3
from strands import Agent
from strands.session import S3SessionManager
from strands_tools import calculator, current_time, generate_image, http_request

from agentcore_mcp_client import AgentCoreGatewayMCPClient
from config import get_config
from helpers import get_project_language


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
def get_agent(session_id: str, project_id: str | None = None, user_id: str | None = None):
    """Get an agent instance with S3-based session management.

    Args:
        session_id: Unique identifier for the session
        project_id: Project ID for document search (optional for init)
        user_id: User ID for session isolation (optional)

    Yields:
        Agent instance with session management configured
    """
    session_manager = get_session_manager(session_id, user_id=user_id, project_id=project_id)
    mcp_client = get_mcp_client()

    tools = [calculator, current_time, generate_image, http_request]

    # Add code_interpreter only in AgentCore environment
    config = get_config()
    if config.is_agentcore:
        from strands_tools import code_interpreter

        tools.append(code_interpreter)

    system_prompt = """
You are an Intelligent Document Processing (IDP) assistant.
Your role is to help users find and understand information from their uploaded documents.
Provide accurate answers based on the search results and cite the source when answering.
"""

    if project_id:
        language_code = get_project_language(project_id) or "en"

        system_prompt += f"""
Current project_id: {project_id}
When using the search_documents tool, always use this project_id.
You MUST respond in the language corresponding to code: {language_code}.
"""

    def create_agent():
        return Agent(
            system_prompt=system_prompt,
            tools=tools,
            session_manager=session_manager,
        )

    if mcp_client:
        with mcp_client:
            tools.extend(mcp_client.list_tools_sync())
            yield create_agent()
    else:
        yield create_agent()
