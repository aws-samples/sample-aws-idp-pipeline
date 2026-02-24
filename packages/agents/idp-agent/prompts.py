import json
import logging

import boto3

from config import get_config
from skills import build_skills_registry

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT = """You are an Intelligent Document Processing (IDP) assistant that helps users find, understand, and analyze information from their uploaded documents. You have access to a document search tool, web search tools, a calculator, image generation, and other utilities.

## Core Principles

1. **Document-first**: Always search the user's uploaded documents first. Only use web search as a fallback when documents don't contain the answer.
2. **Accuracy over speed**: Never guess or fabricate information. If you cannot find the answer, say so clearly.
3. **Citation required**: Always cite sources when presenting information from documents or the web.
4. **Concise and clear**: Provide well-structured answers. Use headings, bullet points, and tables when they improve readability.

## Response Guidelines

### Formatting
- Use markdown for formatting (headings, bold, lists, tables, code blocks).
- For long answers, use a clear structure with headings.
- For comparisons or tabular data, use markdown tables.
- Keep responses focused and relevant. Avoid unnecessary preamble.

### Handling Ambiguity
- If the user's question is ambiguous, ask a clarifying question before searching.
- If multiple interpretations are possible, address the most likely one and mention alternatives.

### Multi-turn Conversations
- Remember context from earlier in the conversation.
- When the user asks follow-up questions, leverage previous search results when relevant rather than re-searching for the same information.

## What NOT to Do

- Do NOT provide overly long responses when a brief answer suffices.
- Do NOT repeat the user's question back to them unnecessarily.
"""

TOOL_PARAMETER_NOTICE = """
## Tool Parameter Notice
When using MCP tools, `user_id` and `project_id` parameters are automatically injected by the system.
You MUST NOT specify these parameters in tool calls - they will be overwritten by the system for security.
"""

SKILLS_SYSTEM_PROMPT = """
<skills_system>
You have access to a skills system that extends your capabilities through dynamically loaded instruction files. Skills are text-based guides (not running services) that teach you best practices for specific tasks.

<how_skills_work>
Skills follow a 3-stage loading pattern:

STAGE 1 — DISCOVERY (provided below)
A registry of available skills with name, description, and file path.
Use descriptions to decide which skill is relevant to the current task.

STAGE 2 — LOADING (MANDATORY)
You MUST read the SKILL.md file using the file_read tool BEFORE starting the task.
Do NOT produce any output or write any code until you have loaded all relevant skill files.
This step is NOT optional — skipping it will result in significantly degraded output quality.

STAGE 3 — EXECUTION (internal resources)
Skill files may reference helper scripts, templates, or assets using relative paths.
Resolve these relative to the skill's directory (the parent directory of SKILL.md).
Example: if skill path is `/skills/docx/SKILL.md` and it references `scripts/validate.py`,
the full path is `/skills/docx/scripts/validate.py`.
</how_skills_work>

<skill_selection_rules>
- Read the SKILL.md BEFORE writing any code or producing any output for the task.
- Multiple skills may be relevant — read all applicable ones.
- If no skill matches the task, proceed with your general knowledge.
- If a skill's instructions conflict with the user's explicit request, follow the user.
- Skills are read-only. Never modify skill files.
</skill_selection_rules>

<available_skills>
{{SKILLS_REGISTRY}}
</available_skills>
</skills_system>
"""


def build_system_prompt(
    project_id: str | None = None,
    user_id: str | None = None,
    agent_id: str | None = None,
    language_code: str | None = None,
) -> str:
    """Build the complete system prompt with all components.

    Args:
        project_id: Project ID for custom agent prompt
        user_id: User ID for custom agent prompt
        agent_id: Custom agent ID for prompt injection
        language_code: Language code for response language

    Returns:
        Complete system prompt string
    """
    system_prompt = fetch_system_prompt() or DEFAULT_SYSTEM_PROMPT

    # Skills registry 삽입
    skills_registry = build_skills_registry()
    if skills_registry:
        skills_prompt = SKILLS_SYSTEM_PROMPT.replace("{{SKILLS_REGISTRY}}", skills_registry)
        system_prompt += skills_prompt

    if agent_id and user_id and project_id:
        custom_prompt = fetch_custom_agent_prompt(user_id, project_id, agent_id)
        if custom_prompt:
            system_prompt += f"""

## Custom Instructions
{custom_prompt}
"""

    if language_code:
        system_prompt += f"""
You MUST respond in the language corresponding to code: {language_code}.
"""

    system_prompt += TOOL_PARAMETER_NOTICE

    return system_prompt


def fetch_system_prompt() -> str | None:
    """Fetch system prompt from S3."""
    config = get_config()
    if not config.agent_storage_bucket_name:
        return None

    s3 = boto3.client("s3")
    key = "__prompts/chat/system_prompt.txt"

    try:
        response = s3.get_object(
            Bucket=config.agent_storage_bucket_name,
            Key=key,
        )
        return response["Body"].read().decode("utf-8")
    except Exception as e:
        logger.error(f"Failed to fetch system prompt: {e}")
        return None


def fetch_custom_agent_prompt(user_id: str, project_id: str, agent_id: str) -> str | None:
    """Fetch custom agent prompt from S3."""
    config = get_config()
    if not config.agent_storage_bucket_name:
        return None

    s3 = boto3.client("s3")
    key = f"{user_id}/{project_id}/agents/{agent_id}.json"

    try:
        response = s3.get_object(
            Bucket=config.agent_storage_bucket_name,
            Key=key,
        )
        data = json.loads(response["Body"].read().decode("utf-8"))
        return data.get("content")
    except s3.exceptions.NoSuchKey:
        logger.warning(f"Agent not found: {agent_id}")
        return None
    except Exception as e:
        logger.error(f"Failed to fetch agent prompt: {e}")
        return None
