import ast
import json
import logging

from strands.hooks.events import BeforeToolCallEvent
from strands.hooks.registry import HookProvider, HookRegistry

logger = logging.getLogger(__name__)


class SyntaxCheckHook(HookProvider):
    """Pre-flight Python syntax check for code_interpreter calls.

    Compiles the generated Python code with `compile()` before dispatching
    to the AgentCore sandbox. On SyntaxError, cancels the tool call and
    returns a clean error message to the model so it can fix and retry
    without paying sandbox cold-start latency.

    The hook MUST NOT raise exceptions out of the callback — any failure
    here would propagate up through the Strands event loop and kill the
    entire agent stream. On any unexpected error, silently skip the check
    and let the tool dispatch proceed as normal.
    """

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(BeforeToolCallEvent, self._check)

    def _check(self, event: BeforeToolCallEvent) -> None:
        try:
            if event.selected_tool is None:
                return
            if event.selected_tool.tool_name != "code_interpreter":
                return

            input_data = event.tool_use.get("input", {})
            if not isinstance(input_data, dict):
                return

            ci_input = input_data.get("code_interpreter_input", {})
            # Model sometimes wraps the whole structured input as a JSON string
            # instead of a dict — defensively parse it.
            if isinstance(ci_input, str):
                try:
                    ci_input = json.loads(ci_input)
                except (json.JSONDecodeError, ValueError):
                    return
            if not isinstance(ci_input, dict):
                return

            action = ci_input.get("action", {})
            if isinstance(action, str):
                try:
                    action = json.loads(action)
                except (json.JSONDecodeError, ValueError):
                    return
            if not isinstance(action, dict):
                return

            if action.get("type") != "executeCode":
                return
            if action.get("language") != "python":
                return

            code = action.get("code", "")
            if not isinstance(code, str) or not code:
                return

            try:
                compile(code, "<agent-generated>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
            except SyntaxError as e:
                line_text = (e.text or "").rstrip()
                message = (
                    f"SyntaxError: {e.msg} (line {e.lineno}, col {e.offset})\n"
                    f"  {line_text}\n"
                    "Pre-execution syntax check failed. Fix the syntax error and retry. "
                    "Common causes: non-ASCII characters used as bare tokens (em-dash, smart quotes), "
                    "unclosed brackets/strings, indentation mistakes."
                )
                logger.warning(
                    "SyntaxCheckHook: cancelled code_interpreter call due to SyntaxError at line %s",
                    e.lineno,
                )
                event.cancel_tool = message

        except Exception as exc:
            # Hook failures MUST NOT break the agent event loop.
            # Log and let the tool dispatch proceed normally.
            logger.warning(
                "SyntaxCheckHook: unexpected error, skipping syntax check (%s: %s)",
                type(exc).__name__,
                exc,
            )
