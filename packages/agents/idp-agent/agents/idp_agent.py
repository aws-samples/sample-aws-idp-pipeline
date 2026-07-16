import json
import time
from contextlib import ExitStack, contextmanager

import boto3
from botocore.config import Config as BotocoreConfig
from botocore.exceptions import BotoCoreError, ClientError
from pydantic import BaseModel
from strands import Agent, AgentSkills
from strands.hooks.registry import HookProvider
from strands.models import BedrockModel
from strands.session import S3SessionManager
from strands_tools import calculator, current_time, file_read, generate_image, http_request, shell, use_llm
from strands_tools.code_interpreter import AgentCoreCodeInterpreter

from agentcore_mcp_client import AgentCoreGatewayMCPClient
from config import get_config
from helpers import get_project_language
from prompts import build_system_prompt
from tools.artifact import create_artifact_path_tool
from tools.ask import ask_user
from tools.charts import render_chart

from .image_artifact_saver_hook import ImageArtifactSaverHook
from .syntax_check_hook import SyntaxCheckHook
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


# SSM parameter holding the chat model catalog. Used here as the allowlist of
# model IDs a client may request; the frontend selector is a UI, not a security
# boundary, so a tampered request must still be validated server-side.
MODEL_CATALOG_SSM_KEY = "/idp-v2/chat/models"
_MODEL_ALLOWLIST_TTL_SECONDS = 300
# Built-in catalog of the shipped models: model id -> supportsReasoning. Mirrors
# the backend's default catalog (packages/backend/app/routers/chat.py). Used
# ONLY when the SSM catalog is missing/malformed/empty, so the default selector
# works before the operator creates the parameter. A valid SSM catalog REPLACES
# it (matching the backend), so removing a model from SSM actually disallows it.
# We keep supportsReasoning (not just ids) so effort is gated on the RESOLVED
# model's capability, not on the originally-requested one (which may have been
# dropped and fallen back to a model that rejects effort).
_DEFAULT_MODEL_CATALOG: dict[str, bool] = {
    "global.anthropic.claude-sonnet-5": True,
    "global.anthropic.claude-opus-4-8": True,
    "global.anthropic.claude-sonnet-4-6": False,
}
# (catalog dict, fetched_at monotonic) - refreshed lazily past the TTL.
_model_catalog_cache: tuple[dict[str, bool], float] | None = None


class _ModelMetrics(BaseModel):
    intelligence: int
    speed: int
    context: int
    cost: int


class _ModelCatalogEntry(BaseModel):
    """Mirror of the backend's ModelCatalogEntry (chat.py). The agent validates
    the SSM catalog with the SAME full-field schema as the backend, so both
    agree on which entries are valid - a partial entry like {"value": "x"} is
    rejected by both, not accepted by one and shown-as-invalid by the other."""

    value: str
    label: str
    description: str
    contextWindow: str
    inputPrice: str
    outputPrice: str
    metrics: _ModelMetrics
    supportsReasoning: bool = True


def _model_catalog() -> dict[str, bool]:
    """Return the model catalog (id -> supportsReasoning) from SSM (cached).

    A valid, non-empty SSM catalog (validated with the full backend schema) is
    authoritative and REPLACES the built-in defaults, so a model removed from
    SSM is no longer callable and a partial/invalid entry can't sneak a model
    in. The built-in defaults are used only when SSM is missing/malformed/empty.
    """
    global _model_catalog_cache
    now = time.monotonic()
    if _model_catalog_cache is not None and now - _model_catalog_cache[1] < _MODEL_ALLOWLIST_TTL_SECONDS:
        return _model_catalog_cache[0]

    config = get_config()
    result = _DEFAULT_MODEL_CATALOG
    try:
        ssm = boto3.client("ssm", region_name=config.aws_region)
        raw = ssm.get_parameter(Name=MODEL_CATALOG_SSM_KEY)["Parameter"]["Value"]
        parsed = json.loads(raw)
        # Validate every entry with the full schema; any invalid entry raises
        # and we keep the built-in defaults (same contract as the backend).
        entries = [_ModelCatalogEntry.model_validate(item) for item in parsed]
        catalog = {e.value: e.supportsReasoning for e in entries}
        if catalog:
            result = catalog
    except (BotoCoreError, ClientError, json.JSONDecodeError, KeyError, TypeError, ValueError):
        # Parameter missing/malformed - keep the built-in defaults.
        result = _DEFAULT_MODEL_CATALOG

    _model_catalog_cache = (result, now)
    return result


def _resolve_model(requested: str | None, default: str) -> tuple[str, bool]:
    """Validate a client-requested model_id against the catalog.

    Returns (resolved_model_id, supports_reasoning). The requested id is used
    ONLY if it is in the authoritative catalog - the config default is NOT
    auto-trusted (a request equal to the default is still checked), so removing
    the default from SSM disallows it too. When neither the request nor the
    default is allowed, we fall back to a deterministic (sorted-first) allowed
    id so the agent still runs; if the catalog is somehow empty we use the
    config default as the last-resort baseline. supports_reasoning is read for
    the RESOLVED model, so effort is never sent to a model that rejects it.
    """
    catalog = _model_catalog()
    if requested and requested in catalog:
        return requested, catalog[requested]
    if default in catalog:
        return default, catalog[default]
    if catalog:
        chosen = next(iter(sorted(catalog)))
        return chosen, catalog[chosen]
    # Empty catalog (shouldn't happen): last-resort baseline, assume reasoning
    # is supported (the shipped default models do).
    return default, True


# UI reasoning level -> Bedrock effort. Both Opus 4.8 and Sonnet 5 accept effort
# via additional_request_fields as {"output_config": {"effort": ...}}. The UI's
# "high" maps to "xhigh" - Anthropic recommends xhigh for agentic use cases,
# which is what this agent does.
REASONING_TO_EFFORT = {
    "low": "low",
    "medium": "medium",
    "high": "xhigh",
}


@contextmanager
def get_agent(
    session_id: str,
    project_id: str | None = None,
    user_id: str | None = None,
    agent_id: str | None = None,
    model_id: str | None = None,
    reasoning: str | None = None,
):
    """Get an agent instance with S3-based session management.

    Args:
        session_id: Unique identifier for the session
        project_id: Project ID for document search (optional for init)
        user_id: User ID for session isolation (optional)
        agent_id: Custom agent ID for prompt injection (optional)
        model_id: Bedrock model id to run this turn (falls back to config default)
        reasoning: UI reasoning level (low/medium/high) -> output_config.effort

    Yields:
        Agent instance with session management configured
    """
    session_manager = get_session_manager(session_id, user_id=user_id, project_id=project_id)
    mcp_client = get_mcp_client()

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
        render_chart,
        ask_user,
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

    # Validate the requested model_id against the SSM catalog; an unknown id
    # (e.g. a tampered request, or a model removed from the catalog) falls back
    # to an allowed model. supports_reasoning is for the RESOLVED model.
    resolved_model_id, supports_reasoning = _resolve_model(model_id, config.bedrock_model_id)
    # Attach output_config.effort only when the client sent a reasoning level
    # AND the resolved model actually supports effort. Gating on the resolved
    # model (not the request) means a fallback to a no-effort model like Sonnet
    # 4.6 won't send an effort field that Bedrock would reject.
    model_kwargs = {
        "model_id": resolved_model_id,
        "region_name": config.aws_region,
        "boto_client_config": BotocoreConfig(read_timeout=600),
    }
    if supports_reasoning and reasoning in REASONING_TO_EFFORT:
        effort = REASONING_TO_EFFORT[reasoning]
        model_kwargs["additional_request_fields"] = {"output_config": {"effort": effort}}
    bedrock_model = BedrockModel(**model_kwargs)

    hooks: list[HookProvider] = [
        ToolParameterEnforcerHook(user_id=user_id, project_id=project_id),
        ImageArtifactSaverHook(user_id=user_id, project_id=project_id),
        SyntaxCheckHook(),
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
        # Web search is provided by the AgentCore Gateway WebSearch target,
        # discovered together with the other gateway tools below.
        if mcp_client:
            stack.enter_context(mcp_client)
            tools.extend(mcp_client.list_tools_sync())

        yield create_agent()
