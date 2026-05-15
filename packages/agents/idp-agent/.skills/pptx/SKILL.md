---
name: pptx
description: "PowerPoint presentation (.pptx) creation, editing, reading, and manipulation skill. Use when the user wants to create, read, edit, or manipulate PowerPoint presentations (.pptx files). Triggers include: any mention of 'slides', 'deck', 'presentation', '.pptx', or requests for slide decks, pitch decks. Also for deliverables as .pptx. When an S3 URI with .pptx extension is provided. Do NOT use for PDFs, Word documents, or Google Slides."
---

# PPTX creation, editing, and analysis

## Execution Rules

- **ALL code execution MUST use the `code_interpreter` tool.** Do NOT use the `shell` tool.
- **NEVER call `!pip install`.** `python-pptx`, `boto3`, `Pillow`, `lxml`, `matplotlib`, `numpy`, `requests`, `markitdown` are pre-installed in the AgentCore Code Interpreter sandbox. Import directly. If an import fails, stop and report the error to the user — do not attempt to install anything.
- **Build the presentation INCREMENTALLY across multiple small `code_interpreter` calls, one or two slides per call.** Do NOT cram the entire deck into a single 30+ KB script. See the Incremental Workflow below.
- **EVERY `code_interpreter` call MUST end with a `print(...)` that reports progress.** Empty stdout is interpreted by the runtime as a failure. Always print at least one line describing what was accomplished.
- Before calling `code_interpreter`, call `artifact_path(filename="presentation.pptx")` to get the S3 bucket and key.
- After the final upload, report the `artifact_ref` to the user.
- **If `code_interpreter` fails with an error, do NOT retry automatically.** Report the error to the user and ask for clarification or guidance. Do not make multiple retry attempts without user input.

## Incremental Workflow

The AgentCore Code Interpreter preserves session state between calls — files written to `/tmp` in one `code_interpreter` invocation remain available in the next call of the same session. Use this to build the deck one slide at a time instead of generating all slides in a single monolithic script.

**Benefits:**
- Each call is small (~1–3 KB of code) and generates in ~15–25 seconds instead of 4+ minutes.
- Failures affect only one slide — previous slides stay saved in `/tmp/deck.pptx`.
- Users see real-time progress: "slide 3/12 added" appears in the UI after each call.

### Call sequence (typical 10-slide deck)

1. `artifact_path(filename="presentation.pptx")` — get S3 URI (ONCE)
2. **Call #1** — Create empty deck, set slide size/theme, save to `/tmp/deck.pptx`
3. **Call #2** — Load deck, add slide 1 (title slide), save
4. **Call #3** — Load deck, add slide 2 (content), save
5. ... one call per slide (or two slides per call if small) ...
6. **Call #N+1** — Load deck, upload `/tmp/deck.pptx` to S3
7. Report `artifact_ref`

### Call #1 — Create empty deck

```python
from pptx import Presentation
from pptx.util import Inches

pres = Presentation()
pres.slide_width = Inches(13.333)   # 16:9
pres.slide_height = Inches(7.5)
pres.save('/tmp/deck.pptx')
print(f"Created blank deck: 16:9, 0 slides. Target total: 10 slides.")
```

### Call #2 — Title slide

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

pres = Presentation('/tmp/deck.pptx')   # load existing
slide = pres.slides.add_slide(pres.slide_layouts[6])   # blank layout

# Title
title_box = slide.shapes.add_textbox(Inches(0.5), Inches(2.8), Inches(12.3), Inches(1.5))
tf = title_box.text_frame
p = tf.paragraphs[0]
p.text = "<presentation title>"
p.alignment = PP_ALIGN.CENTER
p.runs[0].font.size = Pt(44)
p.runs[0].font.bold = True
p.runs[0].font.color.rgb = RGBColor(0x1F, 0x39, 0x64)

# Subtitle
sub_box = slide.shapes.add_textbox(Inches(0.5), Inches(4.5), Inches(12.3), Inches(0.8))
sub_p = sub_box.text_frame.paragraphs[0]
sub_p.text = "<subtitle / author / date>"
sub_p.alignment = PP_ALIGN.CENTER
sub_p.runs[0].font.size = Pt(20)
sub_p.runs[0].font.color.rgb = RGBColor(0x66, 0x66, 0x66)

pres.save('/tmp/deck.pptx')
print(f"Slide 1/{TOTAL} (title) added. Deck now has {len(pres.slides)} slides.")
```

### Call #3…N — Each content slide follows the same load → add → save → print pattern

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

pres = Presentation('/tmp/deck.pptx')
slide = pres.slides.add_slide(pres.slide_layouts[6])

# Slide title
title = slide.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(12.3), Inches(0.8))
t_p = title.text_frame.paragraphs[0]
t_p.text = "<slide title>"
t_p.runs[0].font.size = Pt(28)
t_p.runs[0].font.bold = True
t_p.runs[0].font.color.rgb = RGBColor(0x1F, 0x39, 0x64)

# Body content (bullet list example — replace bullets with actual content)
body = slide.shapes.add_textbox(Inches(0.5), Inches(1.5), Inches(12.3), Inches(5.5))
body_tf = body.text_frame
body_tf.word_wrap = True
bullets = ["<bullet 1>", "<bullet 2>", "<bullet 3>"]
for i, bullet in enumerate(bullets):
    p = body_tf.add_paragraph() if i > 0 else body_tf.paragraphs[0]
    p.text = f"• {bullet}"
    p.runs[0].font.size = Pt(20)

pres.save('/tmp/deck.pptx')
print(f"Slide {len(pres.slides)}/{TOTAL} added.")
```

### Call #N+1 — Upload

```python
import boto3

S3_URI = "s3://idp-v2-agent-storage-008165007574/user/proj/artifacts/art_xxx/deck.pptx"   # paste from artifact_path
BUCKET, KEY = S3_URI.replace("s3://", "").split("/", 1)

s3 = boto3.client('s3')
with open('/tmp/deck.pptx', 'rb') as f:
    s3.upload_fileobj(
        f, BUCKET, KEY,
        ExtraArgs={
            'ContentType': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        }
    )

# Verify
from pptx import Presentation
final = Presentation('/tmp/deck.pptx')
print(f"✅ Uploaded {len(final.slides)} slides to s3://{BUCKET}/{KEY}")
```

Then report the `artifact_ref` to the user.

### Important rules for the incremental workflow

- **Always load the deck from `/tmp/deck.pptx` at the start of each call** — do NOT create a new `Presentation()` except in call #1.
- **Always save back to `/tmp/deck.pptx` at the end of each call** (except the upload call).
- **Each call MUST `print()` at least once** — the runtime treats empty stdout as failure.
- **Use the same filename `/tmp/deck.pptx` throughout** — do not rename between calls.
- **Hardcode the S3 URI string** in the upload call (sandbox cannot access agent variables).
- **Do not split a single slide across multiple calls** — always complete one slide per call at minimum.
- **For 2+ slides per call**, group logically related slides (e.g., two comparison slides together). Keep total code under ~5 KB per call.
- **If a call errors out**, the previous successful saves are still on disk. You can resume from the failed slide.

---

## Quick Reference

| Task | Approach |
|------|----------|
| Read/analyze content | Download from S3 → `markitdown` or `python-pptx` in code_interpreter |
| Create new presentation | Read [python-pptx.md](python-pptx.md), use code_interpreter |
| Edit existing presentation | Read [editing.md](editing.md), unpack → edit XML → repack in code_interpreter |

## Charts

**When the user requests charts or visualizations, always attempt to embed charts directly using `python-pptx` first.** Only use the `chart` skill if direct embedding is not possible or the chart type is unsupported by python-pptx.

```python
from pptx.util import Inches
from pptx.chart.data import ChartData
from pptx import chart as pptx_chart

chart_data = ChartData()
chart_data.categories = ['Q1', 'Q2', 'Q3', 'Q4']
chart_data.add_series('Revenue', (100, 120, 140, 160))

slide.shapes.add_chart(
    pptx_chart.XL_CHART_TYPE.BAR_CLUSTERED,
    Inches(1), Inches(1.5), Inches(8), Inches(3.5),
    chart_data
)
```

---

## Reading Content

Read .pptx files by downloading from the given S3 path and using tools in `code_interpreter`.

```python
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

### Images

Presentations are visual — use real images to make slides compelling.

**Tool selection:**
- If `image___search_image` is available in your tool list, use it to find relevant images *before* calling `code_interpreter`.
- If `image___search_image` is NOT available, use `generate_image` to create custom images that fit each slide's message.

**Workflow:**
1. **Before** `code_interpreter`, plan which slides need images and call `image___search_image` (or `generate_image` if unavailable) for each topic.
2. Collect the returned image URLs.
3. **Inside** `code_interpreter`, download each URL and embed with `add_picture()`.

```python
import requests
from io import BytesIO
from pptx.util import Inches

# Download image from URL (obtained via image___search_image or generate_image)
resp = requests.get(image_url)
slide.shapes.add_picture(BytesIO(resp.content), Inches(5.2), Inches(1.2), Inches(4.5), Inches(3))
```

**Guidelines:**
- Use images on slides with `image_right`, `image_left`, or `image_center` layouts
- Match image content to the slide's topic — generic stock photos weaken the message
- **Max 1 image per slide** — multiple images per slide cause clutter
- **Max 8 images per presentation** — too many slows download and increases file size
- Always specify both width and height, or use aspect ratio preservation (see python-pptx.md)
- If `image___search_image` returns no good results, use `generate_image` as fallback
- For data-heavy slides, prefer charts over images

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

### Structural QA

Run the structural QA script to check layout issues programmatically:

```python
import subprocess
result = subprocess.run(['python', 'scripts/structural_qa.py', 'output.pptx'], capture_output=True, text=True)
print(result.stdout)
```

This checks for:
- Overlapping elements (bounding box intersection)
- Insufficient margin from slide edges (< 0.5")
- Elements too close (< 0.3" gaps)
- Estimated text overflow (text volume vs box size)
- Leftover placeholder content (xxxx, lorem, ipsum, etc.)

### Verification Loop

1. Generate slides → Convert to images → Inspect
2. **List issues found** (if none found, look again more critically)
3. Fix issues
4. **Re-verify affected slides** — one fix often creates another problem
5. Repeat until a full pass reveals no new issues

**Do not declare success until you've completed at least one fix-and-verify cycle.**

---

## Dependencies

`python-pptx`, `markitdown`, `Pillow`, `lxml`, `boto3`, `matplotlib`, `requests` are pre-installed in the Code Interpreter sandbox. Do NOT call `!pip install` — import directly.
