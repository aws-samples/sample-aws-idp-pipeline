"""Web crawler logic using AgentCore Browser."""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Callable
from urllib.parse import urlparse

import boto3
from strands import Agent, tool
from strands_tools.browser import AgentCoreBrowser

from config import get_config
from agents.d2snap import D2Snap, estimate_tokens

logger = logging.getLogger(__name__)

config = get_config()

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
        try:
            logger.info(f"get_compressed_html called for session: {session_name}")

            # Get raw HTML from browser
            html_result = browser_tool.browser(
                browser_input={
                    "action": {
                        "type": "get_html",
                        "session_name": session_name,
                    }
                }
            )

            # Extract HTML string from result
            raw_html = ""
            if isinstance(html_result, dict):
                content = html_result.get("content", [])
                for item in content:
                    if isinstance(item, dict):
                        if "text" in item:
                            raw_html = item["text"]
                            break
                        elif "html" in item:
                            raw_html = item["html"]
                            break

            if not raw_html:
                raw_html = str(html_result)

            original_tokens = estimate_tokens(raw_html)
            logger.info(f"Raw HTML: ~{original_tokens} tokens")

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

        # Create custom tools with context
        save_page_tool, page_state = create_save_page_tool(file_uri)
        get_compressed_html_tool = create_get_compressed_html_tool(browser_tool)

        # Create agent with browser tool and custom tools
        logger.info(f"Creating agent with model={config.bedrock_model_id}")
        agent = Agent(
            model=config.bedrock_model_id,
            tools=[browser_tool.browser, save_page_tool, get_compressed_html_tool, get_current_time],
            system_prompt=system_prompt,
        )
        logger.info("Agent created successfully")

        # Build the prompt for multi-page crawling
        prompt = f"""Start URL: {url}
Language: {language} - Extract and analyze content in this language.

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

        # Execute the agent in a separate thread to avoid event loop conflicts
        logger.warning(f"[TRACE] Executing agent with prompt: {prompt[:100]}...")
        try:
            # Run synchronous agent call in thread pool
            response = await asyncio.to_thread(agent, prompt)
            logger.warning(f"[TRACE] Agent returned! Response type: {type(response)}")
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
