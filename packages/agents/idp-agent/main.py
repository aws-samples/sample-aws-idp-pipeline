import sys

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from pydantic import BaseModel

from agent import get_agent
from config import get_config


class InvokeRequest(BaseModel):
    prompt: str
    session_id: str
    project_id: str


app = BedrockAgentCoreApp()

config = get_config()
if not config.session_storage_bucket_name:
    print("ERROR: SESSION_STORAGE_BUCKET_NAME environment variable is required")
    sys.exit(1)
if not config.mcp_gateway_url:
    print("ERROR: MCP_GATEWAY_URL environment variable is required")
    sys.exit(1)

with get_agent(session_id="init") as agent:
    tool_names = [tool['name'] for tool in agent.tool_registry.get_all_tool_specs()]
    print(f"Loaded {len(tool_names)} tools:")
    for name in tool_names:
        print(f"  - {name}")


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

    with get_agent(session_id=req.session_id, project_id=req.project_id) as agent:
        stream = agent.stream_async(req.prompt)
        async for event in stream:
            filtered = filter_stream_event(event)
            if filtered:
                yield filtered


if __name__ == "__main__":
    import logging

    logging.basicConfig(level=logging.INFO)
    app.run(port=8080)
