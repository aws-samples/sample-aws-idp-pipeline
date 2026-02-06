import asyncio
from contextlib import ExitStack, contextmanager

import boto3
from botocore.config import Config
from nanoid import generate
from strands import Agent, tool
from strands.models import BedrockModel
from strands_tools import current_time, http_request
from strands_tools.code_interpreter import AgentCoreCodeInterpreter

from agents.agentcore_mcp_client import AgentCoreGatewayMCPClient
from agents.constants import REPORT_MODEL_ID
from agents.pptx_prompts import build_system_prompt
from config import get_config

NANOID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_"


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
def get_report_agent(
    session_id: str,
    project_id: str | None = None,
    user_id: str | None = None,
):
    """Get a report agent instance with S3-based session management.

    The report agent specializes in creating PowerPoint presentations
    based on research and gathered information.

    Args:
        session_id: Unique identifier for the session
        project_id: Project ID (optional)
        user_id: User ID for session isolation (optional)

    Yields:
        Report agent instance with session management configured
    """
    config = get_config()
    interpreter = AgentCoreCodeInterpreter(
        region=config.aws_region,
        session_name=session_id,
        identifier=config.code_interpreter_identifier or None,
    )

    # Generate S3 base path for artifact
    artifact_id = f"art_{generate(NANOID_ALPHABET, 12)}"
    artifact_base_path = f"{user_id}/{project_id}/artifacts/{artifact_id}"
    bucket_name = config.agent_storage_bucket_name

    tools = [
        current_time,
        http_request,
        interpreter.code_interpreter,
    ]

    system_prompt = build_system_prompt(bucket_name, artifact_base_path)

    bedrock_model = BedrockModel(
        model_id=REPORT_MODEL_ID,
        region_name=config.aws_region,
        boto_client_config=Config(
            read_timeout=300,
            connect_timeout=10,
            retries={"max_attempts": 3},
        ),
    )

    # Use ExitStack to manage MCP client context
    with ExitStack() as stack:
        mcp_client = get_mcp_client()
        if mcp_client:
            stack.enter_context(mcp_client)
            mcp_tools = mcp_client.list_tools_sync()
            image_tools = [t for t in mcp_tools if "image" in t.tool_name]
            if image_tools:
                tools.extend(image_tools)

        agent = Agent(
            model=bedrock_model,
            system_prompt=system_prompt,
            tools=tools,
        )

        yield agent


def _run_pptx_sync(
    session_id: str,
    project_id: str | None,
    user_id: str | None,
    instructions: str,
) -> str:
    """Run pptx agent synchronously (for use with asyncio.to_thread)."""
    with get_report_agent(session_id, project_id, user_id) as agent:
        result = agent(instructions)
        return str(result)


def create_pptx_tool(session_id: str, project_id: str | None, user_id: str | None):
    """Create a pptx agent tool bound to session context."""

    @tool
    async def pptx_agent(instructions: str) -> str:
        """Create a PowerPoint presentation based on the given instructions.

        Use this tool to:
        - Generate PowerPoint presentations from confirmed plans
        - Create slides with proper formatting and design

        Args:
            instructions: The confirmed plan and context for creating the presentation

        Returns:
            Result of presentation creation including download URL
        """
        return await asyncio.to_thread(
            _run_pptx_sync, session_id, project_id, user_id, instructions
        )

    return pptx_agent
