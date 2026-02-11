from strands.hooks.events import BeforeToolCallEvent
from strands.hooks.registry import HookProvider, HookRegistry


class ToolParameterEnforcerHook(HookProvider):
    """Hook that enforces user_id and project_id parameters for specific tools."""

    def __init__(self, user_id: str | None = None, project_id: str | None = None):
        self.user_id = user_id
        self.project_id = project_id

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(BeforeToolCallEvent, self._enforce_parameters)

    def _enforce_parameters(self, event: BeforeToolCallEvent) -> None:
        if event.selected_tool is None:
            return

        tool_name = event.selected_tool.tool_name

        # MCP tools are prefixed with server name (e.g., "search___hybrid_search")
        is_mcp_tool = "___" in tool_name

        if not is_mcp_tool:
            return

        # Inject user_id and project_id for all MCP tools
        if self.user_id:
            event.tool_use["input"]["user_id"] = self.user_id

        if self.project_id:
            event.tool_use["input"]["project_id"] = self.project_id
