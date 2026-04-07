---
name: markdown
description: "Markdown document (.md) creation and editing skill. Use when the user wants to create or edit Markdown files (.md). Triggers include: any mention of 'markdown', '.md', or requests for documents where Markdown is the appropriate format — such as README files, documentation, technical notes, or when the user explicitly asks for Markdown output. Also when an S3 URI with .md extension is provided. Do NOT use for Word documents (.docx), PDFs, or presentations."
---

# Markdown creation and editing

## Execution Rules

- **ALL code execution MUST use the `code_interpreter` tool.** Do NOT use the `shell` tool.
- **Generate the COMPLETE document and upload to S3 in a SINGLE `code_interpreter` call.** Do NOT split into multiple calls.
- Before calling `code_interpreter`, call `artifact_path(filename="document.md")` to get the S3 bucket and key.
- After completion, report the `artifact_ref` to the user.
- **If `code_interpreter` fails with an error, do NOT retry automatically.** Report the error to the user and ask for clarification or guidance.

### Workflow

1. Call `artifact_path(filename="document.md")` — returns `{ s3_uri, bucket, key, artifact_ref }`
2. **Copy the actual `s3_uri` string value** from the artifact_path result and **hardcode it as a string literal** in your code_interpreter script. Do NOT use variable references — the code_interpreter runs in an isolated sandbox and cannot access the agent's tool results.
3. Call `code_interpreter` ONCE with a single script that writes the Markdown content and uploads to S3.

```python
import boto3

# IMPORTANT: Replace with the ACTUAL s3_uri value returned by artifact_path
S3_URI = "s3://my-bucket/user123/proj456/artifacts/art_abc123/document.md"  # <- paste the actual s3_uri here

# Parse S3 URI into bucket and key
BUCKET, KEY = S3_URI.replace("s3://", "").split("/", 1)

# Build Markdown content
content = """# Document Title

## Section 1

Your content here...

## Section 2

More content...
"""

# Save locally
with open('./output.md', 'w', encoding='utf-8') as f:
    f.write(content)

# Upload to S3
s3 = boto3.client('s3')
with open('./output.md', 'rb') as f:
    s3.upload_fileobj(
        f, BUCKET, KEY,
        ExtraArgs={'ContentType': 'text/markdown'}
    )
```
4. Report the `artifact_ref` to the user

---

## Quick Reference

| Task | Approach |
|------|----------|
| Read/analyze content | Download from S3 → read as text in code_interpreter |
| Create new document | Write Markdown string → upload to S3 in code_interpreter |
| Edit existing document | Download → modify string → re-upload in code_interpreter |

---

## Reading Documents

```python
import boto3

s3 = boto3.client('s3')
obj = s3.get_object(Bucket=bucket, Key=key)
content = obj['Body'].read().decode('utf-8')
print(content)
```

---

## Creating Documents

Markdown is plain text — no special libraries required. Build the content as a Python string.

### Writing Tips

- **Use triple-quoted strings** (`"""..."""`) for multi-line content
- **Use f-strings or `.format()`** to inject dynamic data
- **Escape special characters** when they appear in content (e.g., `\|` in tables, `\*` for literal asterisks)

### Structure

```python
content = f"""# {title}

> {summary}

## Overview

{overview_text}

## Key Findings

{findings}

## Conclusion

{conclusion}
"""
```

---

## Markdown Syntax Reference

### Headings

```markdown
# H1 — Document title (use once)
## H2 — Major sections
### H3 — Subsections
#### H4 — Sub-subsections
```

### Text Formatting

```markdown
**bold text**
*italic text*
***bold italic***
~~strikethrough~~
`inline code`
```

### Lists

```markdown
- Bullet item
  - Nested item
    - Deeper nested

1. Numbered item
2. Second item
   1. Nested numbered

- [ ] Task (unchecked)
- [x] Task (checked)
```

### Links and Images

```markdown
[Link text](https://example.com)
[Link with title](https://example.com "Title")

![Alt text](image_url)
![Alt text](image_url "Image title")
```

### Tables

```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| Data 4   | Data 5   | Data 6   |
```

Alignment:
```markdown
| Left     | Center   | Right    |
|:---------|:--------:|---------:|
| text     | text     | text     |
```

### Code Blocks

````markdown
```python
def hello():
    print("Hello, world!")
```

```json
{"key": "value"}
```
````

### Blockquotes

```markdown
> Single line quote

> Multi-line quote
> continues here
>
> With a paragraph break
```

### Horizontal Rules

```markdown
---
```

### Footnotes

```markdown
Here is a statement[^1].

[^1]: This is the footnote content.
```

---

## Images

**Tool selection:**
- If `image___search_image` is available in your tool list, use it to find relevant images *before* calling `code_interpreter`.
- If `image___search_image` is NOT available, use `generate_image` to create custom images.

**Workflow:**
1. **Before** `code_interpreter`, call `image___search_image` (or `generate_image` if unavailable) for relevant topics.
2. Collect the returned image URLs.
3. **Inside** `code_interpreter`, embed the URLs as Markdown image syntax.

```python
# No download needed — Markdown uses URL references directly
content = f"""# Report Title

## Section with Image

![Description of image]({image_url})

More content below the image...
"""
```

**Guidelines:**
- **Max 5 images per document** — too many images slow rendering
- Match image content to the surrounding text
- Always include descriptive alt text in `![alt text](...)`
- If `image___search_image` returns no good results, use `generate_image` as fallback
- For data, prefer describing it in a Markdown table rather than embedding a chart image

---

## Editing Existing Documents

```python
import boto3

s3 = boto3.client('s3')

# Download
obj = s3.get_object(Bucket=bucket, Key=key)
content = obj['Body'].read().decode('utf-8')

# Modify
content = content.replace('old text', 'new text')

# Or more sophisticated editing
lines = content.split('\n')
# ... manipulate lines ...
content = '\n'.join(lines)

# Save and upload
with open('./output.md', 'w', encoding='utf-8') as f:
    f.write(content)

with open('./output.md', 'rb') as f:
    s3.upload_fileobj(
        f, BUCKET, KEY,
        ExtraArgs={'ContentType': 'text/markdown'}
    )
```

---

## Dependencies

No external dependencies required. Markdown is plain text — use only Python built-ins and `boto3`.
