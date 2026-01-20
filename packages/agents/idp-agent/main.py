import sys

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from agent import get_agent
from config import get_config
from models import InvokeRequest

app = BedrockAgentCoreApp()

config = get_config()
if not config.session_storage_bucket_name:
    print("ERROR: SESSION_STORAGE_BUCKET_NAME environment variable is required")
    sys.exit(1)
if not config.mcp_gateway_url:
    print("ERROR: MCP_GATEWAY_URL environment variable is required")
    sys.exit(1)


def filter_stream_event(event: dict) -> dict | None:
    """Filter and transform stream events for client consumption."""
    # 텍스트 스트리밍
    if "data" in event:
        return {"type": "text", "content": event["data"]}

    # 도구 사용 시작
    if "current_tool_use" in event:
        tool_use = event["current_tool_use"]
        if tool_use.get("name"):
            return {"type": "tool_use", "name": tool_use["name"]}

    # 완료
    if event.get("complete"):
        return {"type": "complete"}

    return None


@app.entrypoint
async def invoke(request: dict):
    """Entry point for agent invocation"""
    req = InvokeRequest(**request)

    with get_agent(session_id=req.session_id, project_id=req.project_id, user_id=req.user_id) as agent:
        content = [block.to_strands() for block in req.prompt]
        stream = agent.stream_async(content)
        async for event in stream:
            filtered = filter_stream_event(event)
            if filtered:
                yield filtered


if __name__ == "__main__":
    import logging

    logging.basicConfig(level=logging.INFO)
    app.run(port=8080)
