import asyncio

from botocore.config import Config
from strands import Agent, tool
from strands.models import BedrockModel

from agents.constants import WRITE_MODEL_ID
from config import get_config


WRITE_SYSTEM_PROMPT = """You are a professional content writer specialized in creating concise content for PowerPoint presentations.

Your role is to:
1. Take a document plan/outline and research findings as input
2. Write SHORT, CONCISE content for each slide
3. Ensure content fits on slides without overflow

## CRITICAL: Keep Content Brief for Slides

PowerPoint slides have LIMITED space. You MUST follow these rules:

### Per Slide Limits:
- Title: Maximum 8 words
- Bullet points: Maximum 4 points per slide
- Each bullet: Maximum 10-15 words (one line)
- NO paragraphs, NO long explanations

### DO:
- ✅ Use short phrases, not sentences
- ✅ Use keywords and key numbers
- ✅ One idea per bullet point
- ✅ Remove filler words (the, a, very, etc.)

### DO NOT:
- ❌ Write full sentences
- ❌ Include detailed explanations
- ❌ Use more than 4 bullet points per slide
- ❌ Write bullets longer than 15 words

## Output Format

For each slide:
```
## [Slide Title - max 8 words]
• [Bullet 1 - max 15 words]
• [Bullet 2 - max 15 words]
• [Bullet 3 - max 15 words]
• [Bullet 4 - max 15 words]
```

## Example

BAD (too long):
```
## The Current State of Cloud Computing in Enterprise Organizations
• Cloud computing has become increasingly important for modern enterprises seeking digital transformation
• Many organizations are now migrating their on-premises infrastructure to cloud-based solutions
```

GOOD (concise):
```
## Cloud Computing in Enterprise
• 85% enterprises adopted cloud (2024)
• Cost reduction: avg 30% savings
• Faster deployment: days vs months
• Scalability on demand
```
"""


def _run_write_sync(
    session_id: str,
    project_id: str | None,
    user_id: str | None,
    instructions: str,
) -> str:
    """Run write agent synchronously (for use with asyncio.to_thread)."""
    config = get_config()

    bedrock_model = BedrockModel(
        model_id=WRITE_MODEL_ID,
        region_name=config.aws_region,
        boto_client_config=Config(
            read_timeout=300,
            connect_timeout=10,
            retries={"max_attempts": 3},
        ),
    )

    agent = Agent(
        model=bedrock_model,
        system_prompt=WRITE_SYSTEM_PROMPT,
        tools=[],
    )

    result = agent(instructions)
    return str(result)


def create_write_tool(session_id: str, project_id: str | None, user_id: str | None):
    """Create a write agent tool bound to session context."""

    @tool
    async def write_agent(instructions: str) -> str:
        """Write detailed content based on a plan and research findings.

        Use this tool to:
        - Convert a document plan into detailed slide content
        - Write presentation-ready content based on research

        Args:
            instructions: The plan outline and research context to write content from

        Returns:
            Detailed content for each section of the plan
        """
        return await asyncio.to_thread(
            _run_write_sync, session_id, project_id, user_id, instructions
        )

    return write_agent
