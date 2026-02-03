import asyncio

from strands import Agent, tool
from strands.models import BedrockModel

from agents.constants import PLAN_MODEL_ID
from config import get_config


PLAN_SYSTEM_PROMPT = """You are a planning agent that creates concise document outlines.

Your role is to help users understand the direction of the document before writing.

Guidelines:
- Keep the plan SHORT and HIGH-LEVEL
- Focus on document structure (sections/chapters)
- Show the overall direction, NOT detailed content
- Use bullet points, avoid lengthy explanations

Do NOT include:
- Detailed descriptions of each section
- Time or page estimates
- Specific content to write in each section
- Quality criteria or checklists

Output Format:
1. **목적**: 1-2 sentences describing what the document will achieve
2. **구성**:
   - Section 1: Title
   - Section 2: Title
   - ...
3. **핵심 포인트**: 3-5 key themes to cover (one line each)
"""


def _run_plan_sync(context: str, requirements: str) -> str:
    """Run plan agent synchronously (for use with asyncio.to_thread)."""
    config = get_config()

    bedrock_model = BedrockModel(
        model_id=PLAN_MODEL_ID,
        region_name=config.aws_region,
    )

    agent = Agent(
        model=bedrock_model,
        system_prompt=PLAN_SYSTEM_PROMPT,
        tools=[],
    )

    prompt = f"""## Context (Research Findings)
{context}

## Requirements
{requirements}

Based on the above context and requirements, create a document outline.
"""
    result = agent(prompt)
    return str(result)


def create_plan_tool(session_id: str, project_id: str | None, user_id: str | None):
    """Create a plan agent tool bound to session context."""

    @tool
    async def plan_agent(context: str, requirements: str) -> str:
        """Create a document outline based on context and requirements.

        Use this tool AFTER gathering information with research_agent.

        Args:
            context: Research findings and gathered information from research_agent
            requirements: User's requirements and goals for the document

        Returns:
            A concise document outline for user confirmation
        """
        return await asyncio.to_thread(_run_plan_sync, context, requirements)

    return plan_agent
