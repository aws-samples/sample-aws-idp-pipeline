# WebCrawler Agent

Web page crawler using AgentCore Browser. Extracts content from URLs and saves as markdown for document analysis pipeline.

## Features

- AgentCore Browser for managed browser automation
- Extracts page content as Markdown
- Takes screenshots
- Stores results in S3 for downstream processing

## Request Format

```json
{
  "workflow_id": "wf_xxx",
  "document_id": "doc_xxx",
  "project_id": "proj_xxx",
  "file_uri": "s3://bucket/path/to/file.webreq",
  "url": "https://example.com",
  "instruction": "Focus on the main article content"
}
```

## Output

- `webcrawler/screenshot.png` - Page screenshot
- `webcrawler/content.md` - Extracted markdown content
- `webcrawler/segment.json` - Segment metadata for pipeline
