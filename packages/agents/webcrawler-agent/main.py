"""WebCrawler Agent - Crawls web pages using AgentCore Browser."""

import json
import logging

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from agents.crawler import crawl_and_process
from config import get_config
from models import WebCrawlRequest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()
config = get_config()


@app.entrypoint
async def invoke(request: dict):
    """Process web crawl request."""
    logger.info(f"Received request: {json.dumps(request)}")

    try:
        req = WebCrawlRequest(**request)

        result = await crawl_and_process(
            workflow_id=req.workflow_id,
            document_id=req.document_id,
            project_id=req.project_id,
            file_uri=req.file_uri,
        )

        yield {"type": "complete", "result": result}

    except Exception as e:
        logger.exception(f"Error processing request: {e}")
        yield {"type": "error", "error": str(e)}


if __name__ == "__main__":
    app.run(port=8080)
