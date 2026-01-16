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


@app.entrypoint
def invoke(request: dict):
    """Entry point for agent invocation"""
    req = InvokeRequest(**request)

    with get_agent(session_id=req.session_id, project_id=req.project_id) as agent:
        result = agent(req.prompt)
        return {"result": result.message}


if __name__ == "__main__":
    import logging

    logging.basicConfig(level=logging.INFO)
    app.run(port=8080)
