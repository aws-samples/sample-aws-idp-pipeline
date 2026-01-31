import json
import re
from contextlib import contextmanager
from datetime import UTC, datetime

import boto3
from nanoid import generate as nanoid_generate
from strands import Agent
from strands.hooks.events import AfterToolCallEvent, BeforeToolCallEvent
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

_config = get_config()
s3_client = boto3.client("s3", region_name=_config.aws_region)
sqs_client = boto3.client("sqs", region_name=_config.aws_region)
dynamodb_resource = boto3.resource("dynamodb", region_name=_config.aws_region)


class ImageArtifactSaverHook(HookProvider):
    """Hook that saves generated images as artifacts after generate_image tool completes."""

    def __init__(self, user_id: str | None = None, project_id: str | None = None):
        self.user_id = user_id
        self.project_id = project_id

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(AfterToolCallEvent, self._save_image_artifact)

    def _save_image_artifact(self, event: AfterToolCallEvent) -> None:
        if event.selected_tool is None:
            return

        tool_name = event.selected_tool.tool_name
        if tool_name != "generate_image":
            return

        if event.exception or not event.result:
            return

        result = event.result
        if result.get("status") != "success":
            return

        if not self.user_id or not self.project_id:
            return

        config = get_config()
        if not config.agent_storage_bucket_name or not config.backend_table_name:
            return

        # Extract image bytes from result content
        image_bytes = None
        image_format = "png"
        for content_block in result.get("content", []):
            if "image" in content_block:
                image_data = content_block["image"]
                image_format = image_data.get("format", "png")
                source = image_data.get("source", {})
                image_bytes = source.get("bytes")
                break

        if not image_bytes:
            return

        # Build filename from prompt
        prompt = event.tool_use.get("input", {}).get("prompt", "generated_image")
        filename = self._create_filename(prompt, image_format)

        try:
            content_type = f"image/{image_format}"
            artifact_id = f"art_{nanoid_generate(size=21)}"
            ext = image_format
            s3_key = f"{self.user_id}/{self.project_id}/artifacts/{artifact_id}.{ext}"
            created_at = datetime.now(UTC).isoformat()

            # Upload to S3
            s3_client.put_object(
                Bucket=config.agent_storage_bucket_name,
                Key=s3_key,
                Body=image_bytes,
                ContentType=content_type,
            )

            # Save metadata to DynamoDB
            table = dynamodb_resource.Table(config.backend_table_name)
            table.put_item(
                Item={
                    "PK": f"ART#{artifact_id}",
                    "SK": "META",
                    "GSI1PK": f"USR#{self.user_id}#ART",
                    "GSI1SK": created_at,
                    "GSI2PK": f"USR#{self.user_id}#PROJ#{self.project_id}#ART",
                    "GSI2SK": created_at,
                    "artifact_id": artifact_id,
                    "created_at": created_at,
                    "data": {
                        "user_id": self.user_id,
                        "project_id": self.project_id,
                        "filename": filename,
                        "content_type": content_type,
                        "s3_key": s3_key,
                        "s3_bucket": config.agent_storage_bucket_name,
                        "file_size": len(image_bytes),
                    },
                }
            )

            # Send websocket notification
            if config.websocket_message_queue_url:
                sqs_client.send_message(
                    QueueUrl=config.websocket_message_queue_url,
                    MessageBody=json.dumps({
                        "username": self.user_id,
                        "message": {
                            "action": "artifacts",
                            "data": {
                                "event": "created",
                                "artifact_id": artifact_id,
                                "filename": filename,
                                "created_at": created_at,
                            },
                        },
                    }),
                )

            # Append artifact info to result content
            result["content"].append(
                {"text": f"\n\n[[artifact:{artifact_id}|{filename}]]"}
            )

        except Exception:
            pass

    @staticmethod
    def _create_filename(prompt: str, fmt: str) -> str:
        words = re.sub(r"[^\w\s]", "", prompt).split()[:5]
        name = "_".join(words) if words else "generated_image"
        return f"{name}.{fmt}"


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

    if mcp_client:
        with mcp_client:
            mcp_tools = mcp_client.list_tools_sync()
            tools.extend(mcp_tools)
            yield create_agent()
    else:
        yield create_agent()
