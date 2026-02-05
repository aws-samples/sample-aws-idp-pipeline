import boto3
from strands import Agent, tool
from strands.hooks.events import BeforeToolCallEvent
from strands.hooks.registry import HookProvider, HookRegistry
from strands.models import BedrockModel

from agents.agentcore_mcp_client import AgentCoreGatewayMCPClient
from agents.constants import RESEARCH_MODEL_ID
from config import get_config


class ToolParameterEnforcerHook(HookProvider):
    """Hook that enforces user_id and project_id parameters for MCP tools."""

    def __init__(self, user_id: str, project_id: str):
        self.user_id = user_id
        self.project_id = project_id

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(BeforeToolCallEvent, self._enforce_parameters)

    def _enforce_parameters(self, event: BeforeToolCallEvent) -> None:
        if event.selected_tool is None:
            return

        tool_name = event.selected_tool.tool_name
        is_mcp_tool = "___" in tool_name

        if not is_mcp_tool:
            return

        print("inject params", self.user_id, self.project_id)

        event.tool_use["input"]["user_id"] = self.user_id
        event.tool_use["input"]["project_id"] = self.project_id


def get_mcp_client():
    """Get MCP client for AgentCore Gateway."""
    config = get_config()
    if not config.mcp_gateway_url:
        return None

    session = boto3.Session()
    credentials = session.get_credentials()

    return AgentCoreGatewayMCPClient.with_iam_auth(
        gateway_url=config.mcp_gateway_url,
        credentials=credentials,
        region=config.aws_region,
    )


RESEARCH_SYSTEM_PROMPT = """You are a research agent specialized in gathering and organizing information.

Your role is to:
1. Search documents and retrieve relevant information using provided tools
2. Read artifacts when needed to gather context
3. Organize and summarize the collected information clearly

Guidelines:
- Use the document search tool to find relevant documents
- Use the artifact read tool to access specific artifacts
- Provide comprehensive but concise summaries of findings
- Include source references when presenting information

Tool Parameter Notice:
When using MCP tools, `user_id` and `project_id` parameters are automatically injected by the system.
You MUST NOT specify these parameters in tool calls.
"""


async def _run_research_async(
    session_id: str,
    project_id: str,
    user_id: str,
    query: str,
) -> str:
    """Run research agent asynchronously."""
    config = get_config()
    mcp_client = get_mcp_client()

    tools = []

    bedrock_model = BedrockModel(
        model_id=RESEARCH_MODEL_ID,
        region_name=config.aws_region,
    )

    print("run search: ", project_id, user_id)

    hooks: list[HookProvider] = [
        ToolParameterEnforcerHook(user_id=user_id, project_id=project_id),
    ]

    def create_agent():
        return Agent(
            model=bedrock_model,
            system_prompt=RESEARCH_SYSTEM_PROMPT,
            tools=tools,
            hooks=hooks,
        )

    if mcp_client:
        with mcp_client:
            mcp_tools = mcp_client.list_tools_sync()
            filtered_tools = [t for t in mcp_tools if "search" in t.tool_name]
            tools.extend(filtered_tools)
            agent = create_agent()
            result = await agent.invoke_async(query)
            return str(result)
    else:
        agent = create_agent()
        result = await agent.invoke_async(query)
        return str(result)


def create_research_tool(session_id: str, project_id: str | None, user_id: str | None):
    """Create a research agent tool bound to session context."""

    @tool
    async def research_agent(query: str) -> str:
        """Search documents and gather information for the given query.

        Use this tool to:
        - Search for relevant documents
        - Read artifacts and gather context
        - Collect information before creating a plan

        Args:
            query: The research query describing what information to gather

        Returns:
            Research findings and gathered information
        """
        return await _run_research_async(session_id, project_id, user_id, query)

    return research_agent
