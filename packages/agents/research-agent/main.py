from bedrock_agentcore.runtime import BedrockAgentCoreApp

from agents.supervisor import get_supervisor_agent
from config import get_config
from models import InvokeRequest

app = BedrockAgentCoreApp()

config = get_config()

# Agent tools that represent workflow stages
STAGE_TOOLS = {"research_agent", "plan_agent", "write_agent", "pptx_agent"}


def extract_tool_result_text(tool_result: dict) -> str:
    """Extract text content from tool result."""
    content = tool_result.get("content", [])
    text_parts = []
    for item in content:
        if "text" in item:
            text_parts.append(item["text"])
    return "\n".join(text_parts)


@app.entrypoint
async def invoke(request: dict):
    req = InvokeRequest(**request)

    with get_supervisor_agent(
        session_id=req.session_id,
        project_id=req.project_id,
        user_id=req.user_id,
    ) as agent:
        content = [block.to_strands() for block in req.prompt]
        stream = agent.stream_async(content)

        current_stage = {"name": None, "started": False}
        last_plan_result = None
        handoff_message = None

        async for event in stream:
            # Yield text data immediately
            if "data" in event:
                yield {"type": "text", "content": event["data"]}

            # Stage start: tool call begins
            if "current_tool_use" in event:
                tool_use = event["current_tool_use"]
                tool_name = tool_use.get("name", "")

                # Detect handoff_to_user call
                if tool_name == "handoff_to_user":
                    tool_input = tool_use.get("input", {})
                    handoff_message = tool_input.get("message", "")

                if tool_name in STAGE_TOOLS:
                    if current_stage.get("name") != tool_name:
                        current_stage["name"] = tool_name
                        current_stage["started"] = True
                        yield {"type": "stage_start", "stage": tool_name}

            # Stage complete: tool result received
            if "message" in event and event["message"].get("role") == "user":
                msg_content = event["message"].get("content", [])
                for block in msg_content:
                    if "toolResult" in block:
                        tool_result = block["toolResult"]
                        stage_name = current_stage.get("name")
                        if current_stage.get("started") and stage_name in STAGE_TOOLS:
                            result_text = extract_tool_result_text(tool_result)
                            current_stage["started"] = False

                            # Save plan result for confirmation
                            if stage_name == "plan_agent":
                                last_plan_result = result_text

                            yield {
                                "type": "stage_complete",
                                "stage": stage_name,
                                "result": result_text,
                            }

            # Final completion
            if event.get("complete"):
                # If handoff_to_user was called, emit confirmation_required
                if handoff_message:
                    yield {
                        "type": "confirmation_required",
                        "message": handoff_message,
                        "plan": last_plan_result or "",
                    }
                else:
                    yield {"type": "complete"}


if __name__ == "__main__":
    import logging

    logging.basicConfig(level=logging.INFO)

    app.run(port=8080)
