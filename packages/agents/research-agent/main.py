from bedrock_agentcore.runtime import BedrockAgentCoreApp

from agents.supervisor import get_supervisor_agent
from config import get_config
from models import InvokeRequest

app = BedrockAgentCoreApp()

config = get_config()


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

        yielded_tool_use_ids = set()

        async for event in stream:
            if "data" in event:
                yield {"type": "text", "content": event["data"]}

            if "current_tool_use" in event:
                tool_use = event["current_tool_use"]
                tool_use_id = tool_use.get("toolUseId")
                if tool_use_id and tool_use_id not in yielded_tool_use_ids:
                    yielded_tool_use_ids.add(tool_use_id)
                    if tool_use.get("name"):
                        yield {"type": "tool_use", "name": tool_use["name"]}

            if "message" in event and event["message"].get("role") == "user":
                msg_content = event["message"].get("content", [])
                for block in msg_content:
                    if "toolResult" in block:
                        tool_result = block["toolResult"]
                        yield {
                            "type": "tool_result",
                            "tool_use_id": tool_result.get("toolUseId"),
                            "content": tool_result.get("content", []),
                            "status": tool_result.get("status"),
                        }

            if event.get("complete"):
                yield {"type": "complete"}


if __name__ == "__main__":
    import logging

    logging.basicConfig(level=logging.INFO)

    app.run(port=8080)
