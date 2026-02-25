---
name: pptx
description: "PowerPoint presentation (.pptx) creation, editing, reading, and manipulation skill."
whenToUse: "Use when the user wants to create, read, edit, or manipulate PowerPoint presentations (.pptx files). Triggers include: any mention of 'slides', 'deck', 'presentation', '.pptx', or requests for slide decks, pitch decks. Also for deliverables as .pptx. When an S3 URI with .pptx extension is provided. Do NOT use for PDFs, Word documents, or Google Slides."
---

# PPTX creation, editing, and analysis

## Execution Rules

- **ALL code execution MUST use the `code_interpreter` tool.** Do NOT use the `shell` tool.
- **Generate the COMPLETE presentation and upload to S3 in a SINGLE `code_interpreter` call.** Do NOT split into multiple calls.
- Before calling `code_interpreter`, call `artifact_path(filename="presentation.pptx")` to get the S3 bucket and key.
- After completion, report the `artifact_ref` to the user.
- **If `code_interpreter` fails with an error, do NOT retry automatically.** Report the error to the user and ask for clarification or guidance. Do not make multiple retry attempts without user input.

### Workflow

1. Call `artifact_path(filename="presentation.pptx")` — returns `{ s3_uri, bucket, key, artifact_ref }`
2. **Copy the actual `s3_uri` string value** from the artifact_path result and **hardcode it as a string literal** in your code_interpreter script. Do NOT use variable references — the code_interpreter runs in an isolated sandbox and cannot access the agent's tool results.
3. Call `code_interpreter` ONCE with a single script that does everything: create the presentation, save it, and upload to S3.

```python
!pip install python-pptx

from pptx import Presentation
import boto3

# IMPORTANT: Replace with the ACTUAL s3_uri value returned by artifact_path
S3_URI = "s3://my-bucket/user123/proj456/artifacts/art_abc123/presentation.pptx"  # ← paste the actual s3_uri here

# Parse S3 URI into bucket and key
BUCKET, KEY = S3_URI.replace("s3://", "").split("/", 1)

# Build entire presentation
pres = Presentation()
# ... all presentation content ...
pres.save('./output.pptx')

# Upload to S3
s3 = boto3.client('s3')
with open('./output.pptx', 'rb') as f:
    s3.upload_fileobj(
        f, BUCKET, KEY,
        ExtraArgs={'ContentType': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'}
    )
```
4. Report the `artifact_ref` to the user

---

## Quick Reference

| Task | Approach |
|------|----------|
| Read/analyze content | Download from S3 → `markitdown` or `python-pptx` in code_interpreter |
| Create new presentation | Read [python-pptx.md](python-pptx.md), use code_interpreter |
| Edit existing presentation | Read [editing.md](editing.md), unpack → edit XML → repack in code_interpreter |

---

## Reading Content

Read .pptx files by downloading from the given S3 path and using tools in `code_interpreter`.

```python
!pip install "markitdown[pptx]"

import boto3

s3 = boto3.client('s3')
s3.download_file(bucket, key, 'presentation.pptx')

# Text extraction
import subprocess
result = subprocess.run(['python', '-m', 'markitdown', 'presentation.pptx'], capture_output=True, text=True)
print(result.stdout)
```

```python
# Visual overview (thumbnail grid)
import subprocess
subprocess.run(['python', 'scripts/thumbnail.py', 'presentation.pptx'])

# Raw XML inspection
subprocess.run(['python', 'scripts/office/unpack.py', 'presentation.pptx', 'unpacked/'])
```

---

## Creating from Scratch

**Read [python-pptx.md](python-pptx.md) for full details.**

Use when no template or reference presentation is available.

---

## Editing Workflow

**Read [editing.md](editing.md) for full details.**

1. Analyze template with `thumbnail.py`
2. Unpack → manipulate slides → edit content → clean → pack

---

## Design Ideas

**Don't create boring slides.** Plain bullets on a white background won't impress anyone. Consider ideas from this list for each slide.

### Before Starting

- **Pick a bold, content-informed color palette**: The palette should feel designed for THIS topic. If swapping your colors into a completely different presentation would still "work," you haven't made specific enough choices.
- **Dominance over equality**: One color should dominate (60-70% visual weight), with 1-2 supporting tones and one sharp accent. Never give all colors equal weight.
- **Dark/light contrast**: Dark backgrounds for title + conclusion slides, light for content ("sandwich" structure). Or commit to dark throughout for a premium feel.
- **Commit to a visual motif**: Pick ONE distinctive element and repeat it — rounded image frames, icons in colored circles, thick single-side borders. Carry it across every slide.

### Color Palettes

Choose colors that match your topic — don't default to generic blue. Use these palettes as inspiration:

| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|--------|
| **Midnight Executive** | `1E2761` (navy) | `CADCFC` (ice blue) | `FFFFFF` (white) |
| **Forest & Moss** | `2C5F2D` (forest) | `97BC62` (moss) | `F5F5F5` (cream) |
| **Coral Energy** | `F96167` (coral) | `F9E795` (gold) | `2F3C7E` (navy) |
| **Warm Terracotta** | `B85042` (terracotta) | `E7E8D1` (sand) | `A7BEAE` (sage) |
| **Ocean Gradient** | `065A82` (deep blue) | `1C7293` (teal) | `21295C` (midnight) |
| **Charcoal Minimal** | `36454F` (charcoal) | `F2F2F2` (off-white) | `212121` (black) |
| **Teal Trust** | `028090` (teal) | `00A896` (seafoam) | `02C39A` (mint) |
| **Berry & Cream** | `6D2E46` (berry) | `A26769` (dusty rose) | `ECE2D0` (cream) |
| **Sage Calm** | `84B59F` (sage) | `69A297` (eucalyptus) | `50808E` (slate) |
| **Cherry Bold** | `990011` (cherry) | `FCF6F5` (off-white) | `2F3C7E` (navy) |

### For Each Slide

**Every slide needs a visual element** — image, chart, icon, or shape. Text-only slides are forgettable.

**Layout options:**
- Two-column (text left, illustration on right)
- Icon + text rows (icon in colored circle, bold header, description below)
- 2x2 or 2x3 grid (image on one side, grid of content blocks on other)
- Half-bleed image (full left or right side) with content overlay

**Data display:**
- Large stat callouts (big numbers 60-72pt with small labels below)
- Comparison columns (before/after, pros/cons, side-by-side options)
- Timeline or process flow (numbered steps, arrows)

**Visual polish:**
- Icons in small colored circles next to section headers
- Italic accent text for key stats or taglines

### Typography

**Choose an interesting font pairing** — don't default to Arial. Pick a header font with personality and pair it with a clean body font.

| Header Font | Body Font |
|-------------|-----------|
| Georgia | Calibri |
| Arial Black | Arial |
| Calibri | Calibri Light |
| Cambria | Calibri |
| Trebuchet MS | Calibri |
| Impact | Arial |
| Palatino | Garamond |
| Consolas | Calibri |

| Element | Size |
|---------|------|
| Slide title | 36-44pt bold |
| Section header | 20-24pt bold |
| Body text | 14-16pt |
| Captions | 10-12pt muted |

### Spacing

- 0.5" minimum margins
- 0.3-0.5" between content blocks
- Leave breathing room—don't fill every inch

### Avoid (Common Mistakes)

- **Don't repeat the same layout** — vary columns, cards, and callouts across slides
- **Don't center body text** — left-align paragraphs and lists; center only titles
- **Don't skimp on size contrast** — titles need 36pt+ to stand out from 14-16pt body
- **Don't default to blue** — pick colors that reflect the specific topic
- **Don't mix spacing randomly** — choose 0.3" or 0.5" gaps and use consistently
- **Don't style one slide and leave the rest plain** — commit fully or keep it simple throughout
- **Don't create text-only slides** — add images, icons, charts, or visual elements; avoid plain title + bullets
- **Don't forget text box padding** — when aligning lines or shapes with text edges, set `margin: 0` on the text box or offset the shape to account for padding
- **Don't use low-contrast elements** — icons AND text need strong contrast against the background; avoid light text on light backgrounds or dark text on dark backgrounds
- **NEVER use accent lines under titles** — these are a hallmark of AI-generated slides; use whitespace or background color instead
- **Max 6 bullet points per slide** — more than 6 makes slides dense and hard to read

---

## Layout Reference

All positions in `Inches(x, y, width, height)`. Slide size: 10" x 5.625" (16:9)

### Position Table

| Layout | Title | Content | Image/Special |
|--------|-------|---------|---------------|
| title_slide | (0.5, 2, 9, 1) | subtitle: (0.5, 3.2, 9, 0.6) | bg: primaryColor |
| default | (0.5, 0.3, 9, 0.8) | (0.5, 1.3, 9, 4) | - |
| two_column | (0.5, 0.3, 9, 0.8) | L:(0.5, 1.3, 4.3, 4) R:(5.2, 1.3, 4.3, 4) | - |
| image_right | (0.5, 0.3, 9, 0.8) | (0.5, 1.3, 4.5, 4) | img:(5.2, 1.2, 4.5, 3) |
| image_left | (0.5, 0.3, 9, 0.8) | (5.2, 1.3, 4.5, 4) | img:(0.3, 1.2, 4.5, 3) |
| image_center | (0.5, 0.3, 9, 0.8) | caption below | img:(2.5, 1.2, 5, 3) |
| comparison | (0.5, 0.3, 9, 0.8) | table:(0.5, 1.3, 9, 3.5) | - |
| quote | - | quote:(1, 1.5, 8, 3) | bg:(245,245,245), "\u201C" at (0.5, 0.8) |
| end | (0.5, 2, 9, 1) centered | - | bg: primaryColor |

### Layout Details

- **title_slide**: Dark background (primaryColor), white text, centered title (44pt) + subtitle (24pt)
- **default**: Standard content slide with title (32pt) and bullet points (20pt)
- **two_column**: Title + two equal columns. Use for pros/cons, comparisons, before/after
- **image_right/left**: Content on one side, image on other
- **image_center**: Large centered image with title above and optional caption below
- **comparison**: Table layout — header row with primaryColor background and white text, data rows with white background
- **quote**: Light gray background, large quote mark "\u201C" (120pt, gray), quote text centered
- **end**: Same style as title_slide, "Thank You" (48pt) or custom closing message

---

## Design Tokens

Default design token values when no specific theme is chosen:

| Token | Value |
|-------|-------|
| Primary (titles/headers) | `RGBColor(0, 51, 102)` — Navy blue |
| White | `RGBColor(255, 255, 255)` |
| Light gray (placeholder bg) | `RGBColor(230, 230, 230)` |
| Medium gray (secondary text) | `RGBColor(128, 128, 128)` |
| Quote bg | `RGBColor(245, 245, 245)` |
| Title slide main | `Pt(44)` |
| Title slide subtitle | `Pt(24)` |
| Slide titles | `Pt(32)` |
| Body text | `Pt(20)` |
| Attribution | `Pt(8)` |
| Bullet spacing | `space_before = Pt(12)` |

---

## QA (Required)

**Assume there are problems. Your job is to find them.**

Your first render is almost never correct. Approach QA as a bug hunt, not a confirmation step. If you found zero issues on first inspection, you weren't looking hard enough.

### Content QA

```python
!pip install "markitdown[pptx]"

import subprocess
result = subprocess.run(['python', '-m', 'markitdown', 'output.pptx'], capture_output=True, text=True)
print(result.stdout)
```

Check for missing content, typos, wrong order.

**When using templates, check for leftover placeholder text:**

```python
import subprocess
result = subprocess.run(['python', '-m', 'markitdown', 'output.pptx'], capture_output=True, text=True)
import re
matches = re.findall(r'(?i)(xxxx|lorem|ipsum|this.*(page|slide).*layout)', result.stdout)
print(matches)
```

If matches are found, fix them before declaring success.

### Visual QA

Convert slides to images, then inspect:

```python
import subprocess
subprocess.run(['python', 'scripts/office/soffice.py', '--headless', '--convert-to', 'pdf', 'output.pptx'])
subprocess.run(['pdftoppm', '-jpeg', '-r', '150', 'output.pdf', 'slide'])
```

This creates `slide-01.jpg`, `slide-02.jpg`, etc.

Look for:
- Overlapping elements (text through shapes, lines through words, stacked elements)
- Text overflow or cut off at edges/box boundaries
- Decorative lines positioned for single-line text but title wrapped to two lines
- Source citations or footers colliding with content above
- Elements too close (< 0.3" gaps) or cards/sections nearly touching
- Uneven gaps (large empty area in one place, cramped in another)
- Insufficient margin from slide edges (< 0.5")
- Columns or similar elements not aligned consistently
- Low-contrast text (e.g., light gray text on cream-colored background)
- Low-contrast icons (e.g., dark icons on dark backgrounds without a contrasting circle)
- Text boxes too narrow causing excessive wrapping
- Leftover placeholder content

### Verification Loop

1. Generate slides → Convert to images → Inspect
2. **List issues found** (if none found, look again more critically)
3. Fix issues
4. **Re-verify affected slides** — one fix often creates another problem
5. Repeat until a full pass reveals no new issues

**Do not declare success until you've completed at least one fix-and-verify cycle.**

---

## Converting to Images

Convert presentations to individual slide images for visual inspection:

```python
import subprocess
subprocess.run(['python', 'scripts/office/soffice.py', '--headless', '--convert-to', 'pdf', 'output.pptx'])
subprocess.run(['pdftoppm', '-jpeg', '-r', '150', 'output.pdf', 'slide'])
```

This creates `slide-01.jpg`, `slide-02.jpg`, etc.

To re-render specific slides after fixes:

```python
import subprocess
subprocess.run(['pdftoppm', '-jpeg', '-r', '150', '-f', 'N', '-l', 'N', 'output.pdf', 'slide-fixed'])
```

---

## Dependencies

All dependencies should be installed within code_interpreter:
```python
!pip install "markitdown[pptx]"
!pip install python-pptx
!pip install Pillow
!pip install lxml
```
