"""Main handler for PPTX MCP Lambda - routes based on tool name from context."""

from .extract_tables import extract_tables
from .extract_text import extract_text


def handler(event: dict, context) -> dict:
    """Route to appropriate handler based on tool name from context.

    The tool name is provided via context.client_context.custom['bedrockAgentCoreToolName']
    in the format: "{target_name}___{tool_name}" (e.g., "pptx___extract_text")

    Args:
        event: Tool-specific input parameters
        context: Lambda context with client_context containing tool name

    Returns:
        Result from the appropriate handler
    """
    tool_name = context.client_context.custom.get("bedrockAgentCoreToolName", "")
    # Extract action from tool name (format: "pptx___extract_text")
    action = tool_name.split("___")[-1] if "___" in tool_name else tool_name

    if action == "extract_text":
        return extract_text(event)
    elif action == "extract_tables":
        return extract_tables(event)
    else:
        raise ValueError(f"Unknown tool: {tool_name}")
