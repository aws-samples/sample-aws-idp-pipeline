"""Web crawler logic using AgentCore Browser."""

import asyncio
import base64
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

logger = logging.getLogger(__name__)

config = get_config()

# Initialize clients
s3_client = boto3.client("s3", region_name=config.aws_region)
dynamodb = boto3.resource("dynamodb", region_name=config.aws_region)

# Default system prompt (fallback if S3 load fails)
DEFAULT_SYSTEM_PROMPT = """You are a web content extractor. Your task is to:
1. Navigate to the given URL
2. Extract the main content of the page
3. IMPORTANT: Before closing the browser, call the save_screenshot tool to capture the final page
4. Return the content as clean, well-structured Markdown

Focus on extracting informative content while ignoring navigation, ads, and other non-content elements.
Preserve headings, lists, tables, and important formatting.
Include image alt texts where relevant.

CRITICAL: You MUST call save_screenshot with the session_name before you close or cleanup the browser session."""

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
            Key="__prompts/webcrawler_system_prompt.txt",
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


# Global storage for screenshot data (set by save_screenshot tool, read after agent completes)
_screenshot_result = {"uri": None, "data": None}


def create_save_screenshot_tool(file_uri: str, browser_tool: AgentCoreBrowser) -> Callable:
    """Create a save_screenshot tool with context baked in."""

    @tool
    def save_screenshot(session_name: str) -> str:
        """Take a screenshot of the current browser page and save it.

        Args:
            session_name: The browser session name to screenshot

        Returns:
            A message confirming the screenshot was saved
        """
        global _screenshot_result

        try:
            logger.info(f"save_screenshot called with session_name={session_name}")

            # Take screenshot using browser tool (full_page not supported by strands_tools)
            screenshot_result = browser_tool.browser(
                browser_input={
                    "action": {
                        "type": "screenshot",
                        "session_name": session_name,
                    }
                }
            )
            logger.info(f"Screenshot taken, result type: {type(screenshot_result)}")
            logger.info(f"Screenshot result: {screenshot_result}")

            # Extract image data
            image_data = None
            local_file_path = None

            if isinstance(screenshot_result, dict):
                # Case 1: Direct image data in response
                if "image" in screenshot_result:
                    img_data = screenshot_result["image"]
                    if isinstance(img_data, str):
                        image_data = img_data
                    elif isinstance(img_data, dict) and "data" in img_data:
                        image_data = img_data["data"]
                elif "screenshot" in screenshot_result:
                    image_data = screenshot_result["screenshot"]
                # Case 2: Local file path in content
                elif "content" in screenshot_result:
                    content = screenshot_result["content"]
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and "text" in item:
                                text = item["text"]
                                # Parse file path from text like "Screenshot saved as screenshots/screenshot_xxx.png"
                                if "Screenshot saved as" in text:
                                    local_file_path = text.replace("Screenshot saved as ", "").strip()
                                    logger.info(f"Found local screenshot path: {local_file_path}")

            # Read from local file if path was found
            if local_file_path and not image_data:
                try:
                    with open(local_file_path, "rb") as f:
                        image_data = f.read()
                    logger.info(f"Read {len(image_data)} bytes from local file")
                    # Delete local file after reading
                    os.remove(local_file_path)
                    logger.info(f"Deleted local screenshot file: {local_file_path}")
                except Exception as read_error:
                    logger.warning(f"Failed to read/delete local screenshot file: {read_error}")

            if not image_data:
                logger.warning(f"No image data found in screenshot result")
                return "Screenshot captured but no image data found"

            # Save to S3 (preprocessed folder for consistency with other document types)
            bucket, base_path = get_document_base_path(file_uri)
            screenshot_key = f"{base_path}/preprocessed/page_0000.png"

            # Decode base64 if needed (only if it's a string, not bytes)
            if isinstance(image_data, str):
                image_bytes = base64.b64decode(image_data)
            else:
                image_bytes = image_data

            s3_client.put_object(
                Bucket=bucket,
                Key=screenshot_key,
                Body=image_bytes,
                ContentType="image/png",
            )

            screenshot_uri = f"s3://{bucket}/{screenshot_key}"
            logger.info(f"Screenshot saved to {screenshot_uri}")

            # Store result for later retrieval
            _screenshot_result["uri"] = screenshot_uri
            _screenshot_result["data"] = base64.b64encode(image_bytes).decode() if isinstance(image_bytes, bytes) else image_data

            return f"Screenshot saved successfully to {screenshot_uri}"

        except Exception as e:
            logger.exception(f"Failed to save screenshot: {e}")
            return f"Failed to save screenshot: {e}"

    return save_screenshot


def get_screenshot_result() -> dict:
    """Get the screenshot result captured by the tool."""
    global _screenshot_result
    result = _screenshot_result.copy()
    # Reset for next use
    _screenshot_result = {"uri": None, "data": None}
    return result


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

        # Create save_screenshot tool with context
        save_screenshot_tool = create_save_screenshot_tool(file_uri, browser_tool)

        # Create agent with browser tool and save_screenshot tool
        logger.info(f"Creating agent with model={config.bedrock_model_id}")
        agent = Agent(
            model=config.bedrock_model_id,
            tools=[browser_tool.browser, save_screenshot_tool],
            system_prompt=system_prompt,
        )
        logger.info("Agent created successfully")

        # Build the prompt
        prompt = f"""Navigate to this URL and extract its content: {url}

Extract the main content as Markdown.
{f'Additional instructions: {instruction}' if instruction else ''}

IMPORTANT: Before closing the browser, you MUST call save_screenshot with the session_name you used.

Return the extracted content in Markdown format."""

        # Execute the agent in a separate thread to avoid event loop conflicts
        logger.warning(f"[TRACE] Executing agent with prompt: {prompt[:100]}...")
        try:
            # Run synchronous agent call in thread pool
            response = await asyncio.to_thread(agent, prompt)
            logger.warning(f"[TRACE] Agent returned! Response type: {type(response)}")
            logger.warning(f"[TRACE] Response message: {response.message if hasattr(response, 'message') else 'no message'}")
        except Exception as agent_error:
            logger.warning(f"[TRACE] Agent exception: {agent_error}")
            logger.exception(f"Agent execution failed: {agent_error}")
            raise
        logger.warning("[TRACE] Proceeding to extract content...")

        # Extract content from response
        content = ""

        logger.info(f"Processing agent response...")
        logger.info(f"Response attributes: {dir(response)}")

        # Try to get content from response message
        if hasattr(response, 'message') and response.message:
            logger.info(f"Response message type: {type(response.message)}")
            logger.info(f"Response message keys: {response.message.keys() if isinstance(response.message, dict) else 'not a dict'}")

            if isinstance(response.message, dict) and "content" in response.message:
                for block in response.message["content"]:
                    if "text" in block:
                        content = block["text"]
                        logger.info(f"Extracted text content: {len(content)} chars")

        # Fallback: try to get text from response directly
        if not content and hasattr(response, 'text'):
            content = response.text
            logger.info(f"Using response.text: {len(content)} chars")

        # Fallback: convert response to string
        if not content:
            content = str(response)
            logger.info(f"Using str(response): {len(content)} chars")

        logger.info(f"Final content length: {len(content)}")

        # Get page title from content (first heading)
        title = url
        lines = content.split("\n")
        for line in lines:
            if line.startswith("# "):
                title = line[2:].strip()
                break

        # Save outputs to S3
        bucket, base_path = get_document_base_path(file_uri)
        logger.info(f"Saving outputs to s3://{bucket}/{base_path}")

        # Get screenshot result from the save_screenshot tool (agent should have called it)
        screenshot_result = get_screenshot_result()
        screenshot_uri = screenshot_result.get("uri")
        if screenshot_uri:
            logger.info(f"Screenshot was saved by agent tool: {screenshot_uri}")
        else:
            logger.warning("Agent did not call save_screenshot tool or it failed")

        # Save markdown content to webcrawler/ folder
        logger.info(f"Saving markdown content ({len(content)} chars)...")
        content_key = f"{base_path}/webcrawler/content.md"
        s3_client.put_object(
            Bucket=bucket,
            Key=content_key,
            Body=content.encode("utf-8"),
            ContentType="text/markdown",
        )
        content_uri = f"s3://{bucket}/{content_key}"
        logger.info(f"Saved content: {content_uri}")

        # Save metadata.json for webcrawler (source_url, title)
        metadata = {
            "url": url,
            "title": title,
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
            "screenshot_uri": screenshot_uri,
            "url": url,
            "title": title,
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
