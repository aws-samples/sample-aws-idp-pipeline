import base64
import sys

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from agent import get_agent
from config import get_config
from models import InvokeRequest


def serialize_tool_result_content(content: list) -> list:
    serialized = []
    for item in content:
        if "image" in item:
            image = item["image"]
            bytes_data = image.get("source", {}).get("bytes")
            if isinstance(bytes_data, bytes):
                serialized.append({
                    "type": "image",
                    "image": {
                        "format": image.get("format", "jpeg"),
                        "source": {"bytes": base64.b64encode(bytes_data).decode("utf-8")},
                    },
                })
            else:
                serialized.append({"type": "image", "image": image})
        elif "text" in item:
            serialized.append({"type": "text", "text": item["text"]})
        else:
            serialized.append(item)
    return serialized

app = BedrockAgentCoreApp()

config = get_config()
if not config.session_storage_bucket_name:
    print("ERROR: SESSION_STORAGE_BUCKET_NAME environment variable is required")
    sys.exit(1)
if not config.mcp_gateway_url:
    print("ERROR: MCP_GATEWAY_URL environment variable is required")
    sys.exit(1)


def filter_stream_event(event: dict) -> dict | None:
    if "data" in event:
        return {"type": "text", "content": event["data"]}

    if "current_tool_use" in event:
        tool_use = event["current_tool_use"]
        if tool_use.get("name"):
            return {"type": "tool_use", "name": tool_use["name"]}

    if "message" in event and event["message"].get("role") == "user":
        content = event["message"].get("content", [])
        for block in content:
            if "toolResult" in block:
                tool_result = block["toolResult"]
                raw_content = tool_result.get("content", [])
                serialized_content = serialize_tool_result_content(raw_content)
                return {
                    "type": "tool_result",
                    "tool_use_id": tool_result.get("toolUseId"),
                    "content": serialized_content,
                    "status": tool_result.get("status"),
                }

    if event.get("complete"):
        return {"type": "complete"}

    return None


@app.entrypoint
async def invoke(request: dict):
    req = InvokeRequest(**request)

    with get_agent(
        session_id=req.session_id,
        project_id=req.project_id,
        user_id=req.user_id,
        agent_id=req.agent_id,
    ) as agent:
        content = [block.to_strands() for block in req.prompt]
        stream = agent.stream_async(content)
        async for event in stream:
            filtered = filter_stream_event(event)
            if filtered:
                yield filtered


if __name__ == "__main__":
    import logging

    logging.basicConfig(level=logging.INFO)

    with get_agent(session_id="test", project_id="test", user_id="test") as agent:
        tool_names = list(agent.tool_registry.registry.keys())
        print(f"Available tools: {tool_names}")

    app.run(port=8080)
