"""Request/Response models for WebCrawler Agent."""

from typing import Optional

from pydantic import BaseModel


class WebCrawlRequest(BaseModel):
    """Request model for web crawling."""

    workflow_id: str
    document_id: str
    project_id: str
    file_uri: str


class WebCrawlResponse(BaseModel):
    """Response model for web crawling."""

    status: str
    workflow_id: str
    output_uri: Optional[str] = None
    screenshot_uri: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = None
    error: Optional[str] = None
