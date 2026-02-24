---
name: docx
description: "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files). Triggers include: any mention of \"Word doc\", \"word document\", \".docx\", or requests to produce professional documents with formatting like tables of contents, headings, page numbers, or letterheads. Also use when extracting or reorganizing content from .docx files, inserting or replacing images in documents, performing find-and-replace in Word files, working with tracked changes or comments, or converting content into a polished Word document. If the user asks for a \"report\", \"memo\", \"letter\", \"template\", or similar deliverable as a Word or .docx file, use this skill. When an S3 URI (s3://...) with a .docx extension is provided, use this skill to process that file. Do NOT use for PDFs, spreadsheets, Google Docs, or general coding tasks unrelated to document generation."
---

# DOCX creation, editing, and analysis

## Execution Rules

- **ALL code execution MUST use the `code_interpreter` tool.** Do NOT use the `shell` tool.
- **Generate the COMPLETE document and upload to S3 in a SINGLE `code_interpreter` call.** Do NOT split into multiple calls.
- Before calling `code_interpreter`, call `artifact_path(filename="report.docx")` to get the S3 bucket and key.
- After completion, report the `artifact_ref` to the user.

### Workflow

1. Call `artifact_path(filename="report.docx")` — returns `{ bucket, key, artifact_ref }`
2. Call `code_interpreter` ONCE with a single script that does everything: create the document, save it, and upload to S3.

```python
!pip install python-docx

from docx import Document
import boto3

# Build entire document
doc = Document()
# ... all document content ...
doc.save('./output.docx')

# Upload to S3 (use bucket and key from artifact_path result)
s3 = boto3.client('s3')
with open('./output.docx', 'rb') as f:
    s3.upload_fileobj(
        f, bucket, key,
        ExtraArgs={'ContentType': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
    )
```
3. Report the `artifact_ref` to the user

---

## Overview

A .docx file is a ZIP archive containing XML files.

## Quick Reference

| Task | Approach |
|------|----------|
| Read/analyze content | Download from S3 → `python-docx` in code_interpreter |
| Create new document | Use `python-docx` in code_interpreter |
| Edit existing document | Unpack → edit XML → repack in code_interpreter |

---

## Reading Documents

Read .docx files by downloading from the given S3 path and using `python-docx` in `code_interpreter`.

```python
!pip install python-docx

import boto3
from docx import Document
from io import BytesIO

s3 = boto3.client('s3')
obj = s3.get_object(Bucket=bucket, Key=key)
doc = Document(BytesIO(obj['Body'].read()))

# Extract all text
for para in doc.paragraphs:
    print(para.text)

# Extract tables
for table in doc.tables:
    for row in table.rows:
        print([cell.text for cell in row.cells])
```

---

## Creating New Documents

Generate .docx files with `python-docx` in code_interpreter.

### Setup
```python
!pip install python-docx

from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

doc = Document()
# ... build document ...
doc.save('./output.docx')
```

### Page Size

```python
from docx.shared import Inches

section = doc.sections[0]
section.page_width = Inches(8.5)    # US Letter
section.page_height = Inches(11)
section.top_margin = Inches(1)
section.bottom_margin = Inches(1)
section.left_margin = Inches(1)
section.right_margin = Inches(1)
```

**Common page sizes:**

| Paper | Width | Height |
|-------|-------|--------|
| US Letter | 8.5 in | 11 in |
| A4 | 8.27 in (21 cm) | 11.69 in (29.7 cm) |

**Landscape orientation:**
```python
section.orientation = WD_ORIENT.LANDSCAPE
section.page_width, section.page_height = section.page_height, section.page_width
```

### Styles

```python
from docx.shared import Pt, RGBColor

style = doc.styles['Normal']
style.font.name = 'Arial'
style.font.size = Pt(12)

# Heading styles
h1 = doc.styles['Heading 1']
h1.font.size = Pt(16)
h1.font.bold = True
h1.font.color.rgb = RGBColor(0, 0, 0)
```

### Paragraphs and Text

```python
p = doc.add_paragraph()
run = p.add_run('Bold text')
run.bold = True
run.font.size = Pt(14)

# Heading
doc.add_heading('Section Title', level=1)

# Alignment
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
```

### Lists

```python
# Bullet list
doc.add_paragraph('Item 1', style='List Bullet')
doc.add_paragraph('Item 2', style='List Bullet')

# Numbered list
doc.add_paragraph('Step 1', style='List Number')
doc.add_paragraph('Step 2', style='List Number')
```

### Tables

```python
table = doc.add_table(rows=3, cols=3)
table.style = 'Table Grid'

# Set cell content
cell = table.cell(0, 0)
cell.text = 'Header'

# Merge cells
table.cell(0, 0).merge(table.cell(0, 1))

# Column widths
for row in table.rows:
    row.cells[0].width = Inches(2)
    row.cells[1].width = Inches(3)
```

### Images

When creating documents, use `image___search_image` to find relevant images, then download and embed them. Choose an appropriate number of images based on the document content, but do NOT exceed 5 images per document.

1. **Before** `code_interpreter`, call `image___search_image` to get image URLs.
2. **Inside** `code_interpreter`, download the URLs and add to the document:

```python
import requests
from io import BytesIO

# Download image from URL (obtained via image___search_image)
resp = requests.get(image_url)
doc.add_picture(BytesIO(resp.content), width=Inches(4))
```

### Page Breaks

```python
doc.add_page_break()
```

### Headers/Footers

```python
section = doc.sections[0]
header = section.header
header.paragraphs[0].text = 'Document Header'

footer = section.footer
footer.paragraphs[0].text = 'Page Footer'
```

### Critical Rules for python-docx

- **Set page size explicitly** - defaults may vary
- **Use `add_paragraph` with styles** for lists, not manual bullet characters
- **Use `Inches()` or `Cm()` or `Pt()`** for all dimension values
- **Table widths** must be set per-cell for consistent rendering
- **Save before uploading** - always `doc.save()` first

---

## Editing Existing Documents

Use code_interpreter for all steps. Download the file from the given S3 path first.

### Step 1: Download and Unpack
```python
import zipfile
import os
import boto3

# Download from S3
s3 = boto3.client('s3')
s3.download_file(bucket, key, 'document.docx')

with zipfile.ZipFile('document.docx', 'r') as z:
    z.extractall('unpacked/')
```

### Step 2: Edit XML

Edit XML files in `unpacked/word/`. See XML Reference below for patterns.

**Use "Claude" as the author** for tracked changes and comments, unless the user explicitly requests use of a different name.

**CRITICAL: Use smart quotes for new content.** When adding text with apostrophes or quotes, use XML entities to produce smart quotes:
```xml
<!-- Use these entities for professional typography -->
<w:t>Here&#x2019;s a quote: &#x201C;Hello&#x201D;</w:t>
```
| Entity | Character |
|--------|-----------|
| `&#x2018;` | ' (left single) |
| `&#x2019;` | ' (right single / apostrophe) |
| `&#x201C;` | " (left double) |
| `&#x201D;` | " (right double) |

### Step 3: Pack
```python
import zipfile
import os

with zipfile.ZipFile('output.docx', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk('unpacked/'):
        for file in files:
            file_path = os.path.join(root, file)
            arcname = os.path.relpath(file_path, 'unpacked/')
            z.write(file_path, arcname)
```

### Common Pitfalls

- **Replace entire `<w:r>` elements**: When adding tracked changes, replace the whole `<w:r>...</w:r>` block with `<w:del>...<w:ins>...` as siblings. Don't inject tracked change tags inside a run.
- **Preserve `<w:rPr>` formatting**: Copy the original run's `<w:rPr>` block into your tracked change runs to maintain bold, font size, etc.

---

## XML Reference

### Schema Compliance

- **Element order in `<w:pPr>`**: `<w:pStyle>`, `<w:numPr>`, `<w:spacing>`, `<w:ind>`, `<w:jc>`, `<w:rPr>` last
- **Whitespace**: Add `xml:space="preserve"` to `<w:t>` with leading/trailing spaces
- **RSIDs**: Must be 8-digit hex (e.g., `00AB1234`)

### Tracked Changes

**Insertion:**
```xml
<w:ins w:id="1" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:t>inserted text</w:t></w:r>
</w:ins>
```

**Deletion:**
```xml
<w:del w:id="2" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:delText>deleted text</w:delText></w:r>
</w:del>
```

**Inside `<w:del>`**: Use `<w:delText>` instead of `<w:t>`, and `<w:delInstrText>` instead of `<w:instrText>`.

**Minimal edits** - only mark what changes:
```xml
<!-- Change "30 days" to "60 days" -->
<w:r><w:t>The term is </w:t></w:r>
<w:del w:id="1" w:author="Claude" w:date="...">
  <w:r><w:delText>30</w:delText></w:r>
</w:del>
<w:ins w:id="2" w:author="Claude" w:date="...">
  <w:r><w:t>60</w:t></w:r>
</w:ins>
<w:r><w:t> days.</w:t></w:r>
```

**Deleting entire paragraphs/list items** - when removing ALL content from a paragraph, also mark the paragraph mark as deleted so it merges with the next paragraph. Add `<w:del/>` inside `<w:pPr><w:rPr>`:
```xml
<w:p>
  <w:pPr>
    <w:numPr>...</w:numPr>  <!-- list numbering if present -->
    <w:rPr>
      <w:del w:id="1" w:author="Claude" w:date="2025-01-01T00:00:00Z"/>
    </w:rPr>
  </w:pPr>
  <w:del w:id="2" w:author="Claude" w:date="2025-01-01T00:00:00Z">
    <w:r><w:delText>Entire paragraph content being deleted...</w:delText></w:r>
  </w:del>
</w:p>
```
Without the `<w:del/>` in `<w:pPr><w:rPr>`, accepting changes leaves an empty paragraph/list item.

**Rejecting another author's insertion** - nest deletion inside their insertion:
```xml
<w:ins w:author="Jane" w:id="5">
  <w:del w:author="Claude" w:id="10">
    <w:r><w:delText>their inserted text</w:delText></w:r>
  </w:del>
</w:ins>
```

**Restoring another author's deletion** - add insertion after (don't modify their deletion):
```xml
<w:del w:author="Jane" w:id="5">
  <w:r><w:delText>deleted text</w:delText></w:r>
</w:del>
<w:ins w:author="Claude" w:id="10">
  <w:r><w:t>deleted text</w:t></w:r>
</w:ins>
```

### Comments

```xml
<!-- Comment markers are direct children of w:p, never inside w:r -->
<w:commentRangeStart w:id="0"/>
<w:r><w:t>commented text</w:t></w:r>
<w:commentRangeEnd w:id="0"/>
<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>
```

**CRITICAL: `<w:commentRangeStart>` and `<w:commentRangeEnd>` are siblings of `<w:r>`, never inside `<w:r>`.**

### Images

1. Add image file to `word/media/`
2. Add relationship to `word/_rels/document.xml.rels`:
```xml
<Relationship Id="rId5" Type=".../image" Target="media/image1.png"/>
```
3. Add content type to `[Content_Types].xml`:
```xml
<Default Extension="png" ContentType="image/png"/>
```
4. Reference in document.xml:
```xml
<w:drawing>
  <wp:inline>
    <wp:extent cx="914400" cy="914400"/>  <!-- EMUs: 914400 = 1 inch -->
    <a:graphic>
      <a:graphicData uri=".../picture">
        <pic:pic>
          <pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing>
```

---

## Dependencies

All dependencies should be installed within code_interpreter:
```python
!pip install python-docx
```
