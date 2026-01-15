import os
from contextlib import contextmanager

from strands import Agent, tool
from strands.session import S3SessionManager
from strands_tools import current_time


# Define a custom tool
@tool
def add(a: int, b: int) -> int:
    return a + b


def get_session_manager(session_id: str) -> S3SessionManager:
    """Get S3SessionManager instance for a session."""
    bucket_name = os.environ.get("SESSION_STORAGE_BUCKET_NAME")
    if not bucket_name:
        raise ValueError("SESSION_STORAGE_BUCKET_NAME environment variable is required")

    return S3SessionManager(
        session_id=session_id,
        bucket=bucket_name,
        prefix="sessions",
    )


@contextmanager
def get_agent(session_id: str):
    """Get an agent instance with S3-based session management.

    Args:
        session_id: Unique identifier for the session (e.g., project_id)

    Yields:
        Agent instance with session management configured
    """
    session_manager = get_session_manager(session_id)

    yield Agent(
        system_prompt="""
You are an addition wizard.
Use the 'add' tool for addition tasks.
Refer to tools as your 'spellbook'.
""",
        tools=[add, current_time],
        session_manager=session_manager,
    )
