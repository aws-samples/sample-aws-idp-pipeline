"""Web crawler logic using AgentCore Browser."""

import asyncio
import json
import logging
import os
import queue as _queue
import threading
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import urlparse

import boto3
from strands import Agent, tool
from strands_tools.browser import AgentCoreBrowser

from config import get_config
from agents.d2snap import D2Snap, estimate_tokens

logger = logging.getLogger(__name__)

config = get_config()

# Per-browser-action timeout (seconds). If a single navigate/get_html/click
# exceeds this window, the wrapper returns an error instead of blocking so
# the agent can skip the URL and continue with a different one.
BROWSER_ACTION_TIMEOUT_SECS = int(os.environ.get("BROWSER_ACTION_TIMEOUT_SECS", "90"))

# Initialize clients
s3_client = boto3.client("s3", region_name=config.aws_region)
dynamodb = boto3.resource("dynamodb", region_name=config.aws_region)

# Default system prompt (fallback if S3 load fails)
DEFAULT_SYSTEM_PROMPT = """You are a multi-page web content extraction agent using AgentCore Browser.

<available_tools>
1. **browser** - Navigate, take screenshots (you can SEE the page), click, type, scroll
2. **get_compressed_html** - Get compressed HTML for efficient content analysis (80-90% token savings)
3. **save_page** - Save extracted page content for the document pipeline. Call once per page.
4. **get_current_time** - Get current date and time
</available_tools>

<workflow>
1. Initialize browser and navigate to the start URL
2. Analyze the page visually (screenshot) and structurally (get_compressed_html)
3. Extract the main content as Markdown
4. Call save_page(url, title, content) to store this page
5. Evaluate the page: does it contain links to detailed content (articles, docs, results)?
   - If YES: follow those links and repeat steps 2-4 for each
   - Use your judgment based on the page type and user instructions
6. Close the browser when done

IMPORTANT:
- Call save_page for EVERY page you want to include in the results
- Use your judgment to decide which links are worth following:
  - News list page -> follow article links to get full articles
  - Search results -> follow result links to get detailed pages
  - Documentation index -> follow doc links
  - Single article/page with no meaningful sub-links -> just extract that page
- Maximum ~20 pages to avoid excessive crawling
- Each saved page should contain substantive content, not just navigation

<error_handling>
Each browser action has a per-call timeout (default 90 seconds). If an
action fails or times out, you receive a JSON object with an `error` field
and possibly `timeout: true`. When that happens:

1. **SKIP the failing URL immediately** — do NOT retry the same URL.
   Retrying a hung URL will just hang again.
2. **Continue with a different URL** from the remaining candidates.
3. **If you run out of candidates**, close the browser and finish with
   whatever pages you have successfully saved so far.
4. **Partial results are valuable** — a crawl that saves 5 out of 10
   planned pages is a success, not a failure. Always save what you have
   and close cleanly.

Common failure modes to skip-and-continue on:
- Site is bot-blocked or returns a challenge page (CAPTCHA, Cloudflare)
- Page never finishes loading (slow server, infinite redirect)
- URL returns 404/403/5xx
- Content is empty or tiny after compression (JS-only SPA we cannot render)
</error_handling>
</workflow>

<content_format>
For each page, extract clean Markdown:
- Page title as H1
- Use ## for sections, ### for subsections
- Preserve lists, tables, code blocks
- No HTML tags in output
- Include source attribution with inline links
</content_format>"""

# Cached system prompt
_system_prompt_cache = None


def load_system_prompt() -> str:
    """Load system prompt from S3 with caching."""
    global _system_prompt_cache

    if _system_prompt_cache is not None:
        return _system_prompt_cache

    try:
        bucket = config.agent_storage_bucket_name
        if not bucket:
            logger.warning("AGENT_STORAGE_BUCKET_NAME not set, using default prompt")
            return DEFAULT_SYSTEM_PROMPT

        response = s3_client.get_object(
            Bucket=bucket,
            Key="__prompts/webcrawler/system_prompt.txt",
        )
        _system_prompt_cache = response["Body"].read().decode("utf-8")
        logger.info("Loaded system prompt from S3")
        return _system_prompt_cache

    except Exception as e:
        logger.warning(f"Failed to load system prompt from S3: {e}, using default")
        return DEFAULT_SYSTEM_PROMPT


def parse_s3_uri(uri: str) -> tuple[str, str]:
    """Parse S3 URI into bucket and key."""
    parsed = urlparse(uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    return bucket, key


def get_document_base_path(file_uri: str) -> tuple[str, str]:
    """Extract bucket and document base path from file URI."""
    bucket, key = parse_s3_uri(file_uri)
    key_parts = key.split("/")

    if "documents" in key_parts:
        doc_idx = key_parts.index("documents")
        base_path = "/".join(key_parts[: doc_idx + 2])
    else:
        base_path = "/".join(key_parts[:-1])

    return bucket, base_path


def create_save_page_tool(file_uri: str) -> tuple[Callable, dict]:
    """Create a save_page tool that stores each crawled page as a JSON file in S3.

    Returns (tool_function, state_dict) where state_dict tracks page_counter.
    """
    state = {"page_counter": 0}

    @tool
    def save_page(url: str, title: str, content: str) -> str:
        """Save extracted page content to S3 for the document pipeline.

        Call this tool once for each page you have fully extracted.
        Pages are automatically numbered in order.

        Args:
            url: The URL of the page
            title: The page title
            content: The extracted content in Markdown format

        Returns:
            A message confirming the page was saved
        """
        try:
            idx = state["page_counter"]
            bucket, base_path = get_document_base_path(file_uri)
            page_key = f"{base_path}/webcrawler/pages/page_{idx:04d}.json"

            page_data = {
                "url": url,
                "title": title,
                "content": content,
                "crawled_at": datetime.now(timezone.utc).isoformat(),
            }

            s3_client.put_object(
                Bucket=bucket,
                Key=page_key,
                Body=json.dumps(page_data, ensure_ascii=False, indent=2),
                ContentType="application/json",
            )

            state["page_counter"] = idx + 1
            logger.info(f"Saved page {idx}: {title} ({len(content)} chars) -> s3://{bucket}/{page_key}")
            return f"Page {idx} saved: {title} ({len(content)} chars)"

        except Exception as e:
            logger.exception(f"Failed to save page: {e}")
            return f"Failed to save page: {e}"

    return save_page, state


@tool
def get_current_time() -> str:
    """Get the current date and time in UTC and common timezones.

    Returns:
        Current datetime in UTC, US Eastern, US Pacific, and Asia/Seoul timezones
    """
    from zoneinfo import ZoneInfo

    utc_now = datetime.now(timezone.utc)

    timezones = {
        "UTC": timezone.utc,
        "US/Eastern": ZoneInfo("America/New_York"),
        "US/Pacific": ZoneInfo("America/Los_Angeles"),
        "Asia/Seoul": ZoneInfo("Asia/Seoul"),
    }

    result = []
    for tz_name, tz in timezones.items():
        local_time = utc_now.astimezone(tz)
        result.append(f"{tz_name}: {local_time.strftime('%Y-%m-%d %H:%M:%S %Z')}")

    return "\n".join(result)


def _invoke_browser_with_timeout(
    browser_tool: AgentCoreBrowser,
    browser_input: dict,
    timeout_secs: int = BROWSER_ACTION_TIMEOUT_SECS,
) -> tuple[str, Any]:
    """Call `browser_tool.browser(browser_input=...)` with a per-action timeout.

    Returns a tuple `(status, value)`:
      - `("ok", result)` on success
      - `("timeout", error_message)` if the call exceeds `timeout_secs`
      - `("error", exception_instance)` if the call raises

    The underlying browser call runs in a daemon thread. On timeout the
    background thread is NOT killed (Playwright does not support cancellation
    cleanly); it will eventually complete in the background. The agent,
    however, is freed to move on to a different URL.
    """
    action_type = "unknown"
    action_target = ""
    try:
        if isinstance(browser_input, dict):
            action = browser_input.get("action", {}) or {}
            if isinstance(action, dict):
                action_type = action.get("type", "unknown")
                action_target = action.get("url") or action.get("selector") or ""
    except Exception:
        pass

    result_q: _queue.Queue = _queue.Queue()

    def _invoke() -> None:
        try:
            result = browser_tool.browser(browser_input=browser_input)
            result_q.put(("ok", result))
        except Exception as exc:
            result_q.put(("error", exc))

    worker = threading.Thread(target=_invoke, daemon=True)
    worker.start()

    try:
        return result_q.get(timeout=timeout_secs)
    except _queue.Empty:
        msg = (
            f"Browser action '{action_type}' exceeded {timeout_secs}s timeout"
            + (f" for {action_target}" if action_target else "")
        )
        logger.warning(f"[BROWSER_TIMEOUT] {msg}")
        return ("timeout", msg)


def create_safe_browser_tool(
    browser_tool: AgentCoreBrowser,
    timeout_secs: int = BROWSER_ACTION_TIMEOUT_SECS,
) -> Callable:
    """Create a timeout-guarded wrapper around `browser_tool.browser`.

    When a single action (e.g. navigate to an unresponsive URL) hangs for
    longer than `timeout_secs`, this wrapper returns a structured JSON error
    to the agent instead of blocking the entire run. The agent is expected
    to skip the failing URL and continue with a different one (see system
    prompt).
    """

    @tool
    def browser(browser_input: dict) -> str:
        """Interact with the AgentCore browser. Each action has a per-call
        timeout so unresponsive URLs don't stall the whole crawl.

        `browser_input` format examples:
          - Navigate:   {"action": {"type": "navigate", "session_name": "s1", "url": "https://..."}}
          - Get HTML:   {"action": {"type": "get_html", "session_name": "s1"}}
          - Screenshot: {"action": {"type": "screenshot", "session_name": "s1"}}
          - Click:      {"action": {"type": "click", "session_name": "s1", "selector": "..."}}
          - Type:       {"action": {"type": "type", "session_name": "s1", "selector": "...", "text": "..."}}
          - Close:      {"action": {"type": "close_browser"}}

        If the action times out or errors, you receive a JSON object
        containing `error`, `timeout` (bool), and `action_type` fields. When
        that happens, SKIP the current URL and move on to a different URL.
        Do NOT retry the same URL — it will just hang again.
        """
        action_type = "unknown"
        action_target = ""
        try:
            if isinstance(browser_input, dict):
                action = browser_input.get("action", {}) or {}
                if isinstance(action, dict):
                    action_type = action.get("type", "unknown")
                    action_target = action.get("url") or action.get("selector") or ""
        except Exception:
            pass

        status, value = _invoke_browser_with_timeout(browser_tool, browser_input, timeout_secs)

        if status == "ok":
            return value
        if status == "timeout":
            return json.dumps(
                {
                    "error": str(value),
                    "timeout": True,
                    "action_type": action_type,
                    "target": action_target,
                    "hint": "Skip this URL and continue with a different one. Do not retry.",
                },
                ensure_ascii=False,
            )
        # status == "error"
        logger.warning(f"[BROWSER_ERR] action={action_type} target={action_target} error={value}")
        return json.dumps(
            {
                "error": str(value),
                "action_type": action_type,
                "target": action_target,
                "hint": "This action failed. Try a different URL or a different approach.",
            },
            ensure_ascii=False,
        )

    return browser


def create_get_compressed_html_tool(browser_tool: AgentCoreBrowser) -> Callable:
    """Create a get_compressed_html tool for efficient HTML analysis."""

    @tool
    def get_compressed_html(session_name: str, max_tokens: int = 8000) -> str:
        """Get compressed HTML from the current page for efficient content analysis.

        This tool extracts HTML from the page and compresses it using D2Snap,
        reducing token usage by 70-90% while preserving important content elements.

        Use this BEFORE extracting content to understand page structure efficiently.

        Args:
            session_name: The browser session name
            max_tokens: Maximum token budget for compressed HTML (default 8000)

        Returns:
            Compressed HTML with content structure preserved, plus compression stats
        """
        import time

        def _extract_html() -> str:
            status, result = _invoke_browser_with_timeout(
                browser_tool,
                {
                    "action": {
                        "type": "get_html",
                        "session_name": session_name,
                    }
                },
            )
            if status != "ok":
                # Return empty string so caller falls through to the
                # "HTML too small" retry / warning path; never raise here
                # because that would abort the agent step.
                logger.warning(f"_extract_html {status}: {result}")
                return ""
            html_result = result
            raw = ""
            if isinstance(html_result, dict):
                content = html_result.get("content", [])
                for item in content:
                    if isinstance(item, dict):
                        if "text" in item:
                            raw = item["text"]
                            break
                        elif "html" in item:
                            raw = item["html"]
                            break
            if not raw:
                raw = str(html_result)
            return raw

        try:
            logger.info(f"get_compressed_html called for session: {session_name}")

            raw_html = _extract_html()
            original_tokens = estimate_tokens(raw_html)
            logger.info(f"Raw HTML: ~{original_tokens} tokens")

            # If HTML is too small, JS may not have finished rendering.
            # Wait and retry up to 2 times.
            for attempt in range(2):
                if original_tokens >= 500:
                    break
                wait_secs = 3 * (attempt + 1)
                logger.warning(
                    f"HTML too small ({original_tokens} tokens), "
                    f"waiting {wait_secs}s for JS to render (attempt {attempt + 1}/2)"
                )
                time.sleep(wait_secs)
                raw_html = _extract_html()
                original_tokens = estimate_tokens(raw_html)
                logger.info(f"Retry HTML: ~{original_tokens} tokens")

            if original_tokens < 100:
                logger.warning(
                    f"HTML still very small ({original_tokens} tokens) after retries. "
                    "Page may require JS rendering or is behind a challenge page. "
                    "Rely on screenshot for visual analysis instead."
                )
                return (
                    f"[WARNING] Page HTML is very small (~{original_tokens} tokens). "
                    "This usually means the page is JavaScript-heavy or behind a challenge. "
                    "Use browser screenshot to visually analyze the page content instead."
                )

            # Apply D2Snap compression
            result = D2Snap.compress(raw_html, max_tokens, 'hybrid')

            compressed_html = result['compressed_html']
            stats = f"""
[Compression Stats]
- Original: ~{result['original_tokens']} tokens
- Compressed: ~{result['compressed_tokens']} tokens
- Reduction: {result['reduction_percent']}%

[Compressed HTML]
{compressed_html}
"""
            logger.info(f"Compressed HTML: ~{result['compressed_tokens']} tokens ({result['reduction_percent']}% reduction)")

            return stats

        except Exception as e:
            logger.exception(f"Failed to get compressed HTML: {e}")
            return f"Error getting compressed HTML: {e}"

    return get_compressed_html


def update_preprocess_status(
    document_id: str,
    workflow_id: str,
    status: str,
    error: str = None,
):
    """Update preprocess status in DynamoDB (both WEB# and STEP records)."""
    table = dynamodb.Table(config.backend_table_name)
    now = datetime.now(timezone.utc).isoformat()

    # 1. Update WEB# entity (preprocess.webcrawler.status)
    update_expr = "SET #data.preprocess.webcrawler.#status = :status"
    expr_names = {
        "#data": "data",
        "#status": "status",
    }
    expr_values = {":status": status}

    if status == "processing":
        update_expr += ", #data.preprocess.webcrawler.started_at = :started_at"
        expr_values[":started_at"] = now

    if status == "completed":
        update_expr += ", #data.preprocess.webcrawler.ended_at = :ended_at"
        expr_values[":ended_at"] = now

    if status == "failed" and error:
        update_expr += ", #data.preprocess.webcrawler.#error = :error"
        expr_names["#error"] = "error"
        expr_values[":error"] = error

    table.update_item(
        Key={"PK": f"WEB#{document_id}", "SK": f"WF#{workflow_id}"},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )

    # 2. Update STEP record (data.webcrawler.status)
    step_status = "in_progress" if status == "processing" else status
    step_update_expr = "SET #data.webcrawler.#status = :status, #data.current_step = :current_step"
    step_expr_names = {
        "#data": "data",
        "#status": "status",
    }
    step_expr_values = {
        ":status": step_status,
        ":current_step": "webcrawler" if status == "processing" else "",
    }

    if status == "processing":
        step_update_expr += ", #data.webcrawler.started_at = :started_at"
        step_expr_values[":started_at"] = now

    if status == "completed":
        step_update_expr += ", #data.webcrawler.ended_at = :ended_at"
        step_expr_values[":ended_at"] = now

    if status == "failed" and error:
        step_update_expr += ", #data.webcrawler.#error = :error"
        step_expr_names["#error"] = "error"
        step_expr_values[":error"] = error

    try:
        table.update_item(
            Key={"PK": f"WF#{workflow_id}", "SK": "STEP"},
            UpdateExpression=step_update_expr,
            ExpressionAttributeNames=step_expr_names,
            ExpressionAttributeValues=step_expr_values,
        )
        logger.info(f"Updated STEP record webcrawler status to {step_status}")
    except Exception as e:
        logger.warning(f"Failed to update STEP record: {e}")


def download_webreq(file_uri: str) -> dict:
    """Download and parse .webreq file from S3."""
    bucket, key = parse_s3_uri(file_uri)
    response = s3_client.get_object(Bucket=bucket, Key=key)
    content = response["Body"].read().decode("utf-8")
    return json.loads(content)


async def crawl_and_process(
    workflow_id: str,
    document_id: str,
    project_id: str,
    file_uri: str,
    language: str = 'en',
) -> dict:
    """Crawl web page and process content."""
    logger.warning(f"[TRACE] crawl_and_process started: workflow={workflow_id}")

    # Download and parse .webreq file
    webreq = download_webreq(file_uri)
    url = webreq.get("url", "")
    instruction = webreq.get("instruction", "")

    if not url:
        raise ValueError("URL is required in .webreq file")

    logger.info(f"Starting crawl: workflow={workflow_id}, url={url}")

    # Update status to processing
    update_preprocess_status(document_id, workflow_id, "processing")

    try:
        # Load system prompt from S3
        system_prompt = load_system_prompt()

        # Initialize AgentCore Browser
        logger.info(f"Initializing AgentCoreBrowser with region={config.aws_region}")
        browser_tool = AgentCoreBrowser(region=config.aws_region)
        logger.info("AgentCoreBrowser initialized")

        # Serialize all browser operations with a lock.
        # The Strands Agent may call browser(screenshot) and
        # get_compressed_html (-> browser(get_html)) in parallel from
        # separate threads, causing Python 3.13 contextvars conflicts
        # in Playwright's pipe transport ("cannot enter context:
        # already entered").  Locking _execute_async ensures only one
        # Playwright action runs at a time.
        _browser_lock = threading.Lock()
        _orig_execute = browser_tool._execute_async

        def _serialized_execute(action_coro):
            with _browser_lock:
                return _orig_execute(action_coro)

        browser_tool._execute_async = _serialized_execute

        # Create custom tools with context
        save_page_tool, page_state = create_save_page_tool(file_uri)
        get_compressed_html_tool = create_get_compressed_html_tool(browser_tool)
        # Wrap the raw browser tool with a per-action timeout so a single
        # unresponsive URL (e.g. bot-blocked article page) cannot hang the
        # whole crawl for the full AgentCore idle window.
        safe_browser_tool = create_safe_browser_tool(
            browser_tool, timeout_secs=BROWSER_ACTION_TIMEOUT_SECS
        )

        # Create agent with browser tool and custom tools
        logger.info(f"Creating agent with model={config.bedrock_model_id}")
        agent = Agent(
            model=config.bedrock_model_id,
            tools=[safe_browser_tool, save_page_tool, get_compressed_html_tool, get_current_time],
            system_prompt=system_prompt,
        )
        logger.info("Agent created successfully")

        # Build the prompt for multi-page crawling
        prompt = f"""Start URL: {url}

{f'Instructions: {instruction}' if instruction else ''}

Workflow:
1. Initialize browser session and navigate to the URL
2. Use browser screenshot to SEE the page, then get_compressed_html for structure
3. Extract content as clean Markdown
4. Call save_page(url, title, content) to store this page
5. Look at the page - if it contains links to detailed content (articles, docs, results), follow them and repeat steps 2-4
6. Close the browser when done

IMPORTANT:
- Call save_page for EVERY page you extract
- Use your judgment to decide which links are worth following based on the page type and instructions"""

        # Execute the agent in an isolated thread to avoid contextvars
        # conflicts between asyncio.to_thread and Playwright in Python 3.13.
        # Plain threading.Thread does not copy the parent context, preventing
        # "cannot enter context: already entered" errors in Playwright's
        # pipe transport callbacks.
        logger.warning(f"[TRACE] Executing agent with prompt: {prompt[:100]}...")
        loop = asyncio.get_running_loop()
        future = loop.create_future()

        # Keep agent-level timeout BELOW AgentCore idle session timeout (15 min)
        # so the agent surfaces a clean TimeoutError via update_preprocess_status
        # BEFORE AgentCore tears down the container silently.
        AGENT_TIMEOUT_SECS = int(os.environ.get("AGENT_TIMEOUT_SECS", "780"))

        def _run_agent():
            try:
                result = agent(prompt)
                loop.call_soon_threadsafe(future.set_result, result)
            except Exception as e:
                loop.call_soon_threadsafe(future.set_exception, e)

        agent_thread = threading.Thread(target=_run_agent, daemon=True)
        agent_thread.start()

        try:
            response = await asyncio.wait_for(future, timeout=AGENT_TIMEOUT_SECS)
            logger.warning(f"[TRACE] Agent returned! Response type: {type(response)}")
        except asyncio.TimeoutError:
            logger.error(
                f"Agent execution timed out after {AGENT_TIMEOUT_SECS}s "
                f"for workflow={workflow_id}"
            )
            raise TimeoutError(
                f"Agent execution timed out after {AGENT_TIMEOUT_SECS}s"
            )
        except Exception as agent_error:
            logger.warning(f"[TRACE] Agent exception: {agent_error}")
            logger.exception(f"Agent execution failed: {agent_error}")
            raise
        logger.warning("[TRACE] Proceeding to save metadata...")

        total_pages = page_state["page_counter"]
        logger.info(f"Agent saved {total_pages} pages")

        # Save metadata.json for webcrawler
        bucket, base_path = get_document_base_path(file_uri)
        metadata = {
            "start_url": url,
            "instruction": instruction,
            "total_pages": total_pages,
            "crawled_at": datetime.now(timezone.utc).isoformat(),
        }
        metadata_key = f"{base_path}/webcrawler/metadata.json"
        s3_client.put_object(
            Bucket=bucket,
            Key=metadata_key,
            Body=json.dumps(metadata, ensure_ascii=False, indent=2),
            ContentType="application/json",
        )
        logger.info(f"Saved metadata: s3://{bucket}/{metadata_key}")

        # Update status to completed
        logger.warning("[TRACE] Updating DynamoDB status to completed...")
        update_preprocess_status(document_id, workflow_id, "completed")
        logger.warning("[TRACE] All done! Returning result...")

        return {
            "status": "completed",
            "workflow_id": workflow_id,
            "total_pages": total_pages,
            "url": url,
        }

    except Exception as e:
        logger.warning(f"[TRACE] Exception in crawl_and_process: {e}")
        logger.exception(f"Error crawling {url}: {e}")
        update_preprocess_status(document_id, workflow_id, "failed", error=str(e))
        return {
            "status": "failed",
            "workflow_id": workflow_id,
            "error": str(e),
        }
