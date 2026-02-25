# python-pptx Reference

## Setup & Basic Structure

```python
from pptx import Presentation
from pptx.util import Inches, Pt, Cm, Emu
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.dml.color import RGBColor

pres = Presentation()
pres.slide_width = Inches(10)
pres.slide_height = Inches(5.625)  # 16:9
pres.core_properties.author = 'Your Name'
pres.core_properties.title = 'Presentation Title'

blank_layout = pres.slide_layouts[6]  # Blank layout
slide = pres.slides.add_slide(blank_layout)

txBox = slide.shapes.add_textbox(Inches(0.5), Inches(0.5), Inches(8), Inches(1))
txBox.text_frame.text = "Hello World!"
txBox.text_frame.paragraphs[0].font.size = Pt(36)
txBox.text_frame.paragraphs[0].font.color.rgb = RGBColor(0x36, 0x36, 0x36)

pres.save('Presentation.pptx')
```

## Slide Layouts

Common slide layout indices (may vary by template):
- `0`: Title Slide
- `1`: Title and Content
- `5`: Title Only
- `6`: Blank

## Layout Dimensions

Slide dimensions:
- **16:9**: `Inches(10)` x `Inches(5.625)` (default)
- **16:10**: `Inches(10)` x `Inches(6.25)`
- **4:3**: `Inches(10)` x `Inches(7.5)`
- **Widescreen**: `Inches(13.3)` x `Inches(7.5)`

---

## Text & Formatting

```python
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.dml.color import RGBColor

# Basic text box
txBox = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(2))
tf = txBox.text_frame
tf.word_wrap = True

p = tf.paragraphs[0]
p.text = "Simple Text"
p.font.size = Pt(24)
p.font.name = "Arial"
p.font.color.rgb = RGBColor(0x36, 0x36, 0x36)
p.font.bold = True
p.alignment = PP_ALIGN.CENTER

# Vertical alignment
tf.word_wrap = True
txBox.text_frame.auto_size = None  # Fixed size
# Use MSO_ANCHOR.MIDDLE for vertical centering
from pptx.enum.text import MSO_ANCHOR
tf.paragraphs[0].alignment = PP_ALIGN.CENTER

# Rich text (multiple runs in one paragraph)
p = tf.paragraphs[0]
p.clear()
run1 = p.add_run()
run1.text = "Bold "
run1.font.bold = True
run2 = p.add_run()
run2.text = "Italic "
run2.font.italic = True

# Multi-line text (separate paragraphs)
tf.text = "Line 1"
p2 = tf.add_paragraph()
p2.text = "Line 2"
p3 = tf.add_paragraph()
p3.text = "Line 3"

# Text box internal margin
txBox.text_frame.margin_left = Inches(0)
txBox.text_frame.margin_right = Inches(0)
txBox.text_frame.margin_top = Inches(0)
txBox.text_frame.margin_bottom = Inches(0)
```

**Tip:** Text boxes have internal margins by default. Set all margins to `Inches(0)` when you need text to align precisely with shapes or icons.

### Character Spacing

```python
from pptx.oxml.ns import qn

run = p.add_run()
run.text = "SPACED TEXT"
# Character spacing in hundredths of a point (600 = 6pt)
run._r.get_or_add(qn('a:rPr')).set('spc', '600')
```

---

## Lists & Bullets

```python
from pptx.oxml.ns import qn
from lxml import etree

txBox = slide.shapes.add_textbox(Inches(0.5), Inches(0.5), Inches(8), Inches(3))
tf = txBox.text_frame
tf.word_wrap = True

# Bullet list
items = ["First item", "Second item", "Third item"]
for i, item in enumerate(items):
    if i == 0:
        p = tf.paragraphs[0]
    else:
        p = tf.add_paragraph()
    p.text = item
    p.level = 0
    p.font.size = Pt(16)
    # Add bullet
    pPr = p._p.get_or_add_pPr()
    buChar = etree.SubElement(pPr, qn('a:buChar'))
    buChar.set('char', '\u2022')

# Sub-items (indented)
p = tf.add_paragraph()
p.text = "Sub-item"
p.level = 1

# Numbered list
pPr = p._p.get_or_add_pPr()
buAutoNum = etree.SubElement(pPr, qn('a:buAutoNum'))
buAutoNum.set('type', 'arabicPeriod')
```

**Note:** python-pptx does not have built-in high-level bullet API. Use XML manipulation via `pPr` for bullet characters.

---

## Shapes

```python
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor

# Rectangle
shape = slide.shapes.add_shape(
    MSO_SHAPE.RECTANGLE,
    Inches(0.5), Inches(0.8), Inches(1.5), Inches(3.0)
)
shape.fill.solid()
shape.fill.fore_color.rgb = RGBColor(0xFF, 0x00, 0x00)
shape.line.color.rgb = RGBColor(0x00, 0x00, 0x00)
shape.line.width = Pt(2)

# Oval
shape = slide.shapes.add_shape(
    MSO_SHAPE.OVAL,
    Inches(4), Inches(1), Inches(2), Inches(2)
)
shape.fill.solid()
shape.fill.fore_color.rgb = RGBColor(0x00, 0x00, 0xFF)

# Line (use a connector or a thin rectangle)
from pptx.enum.shapes import MSO_SHAPE
connector = slide.shapes.add_shape(
    MSO_SHAPE.RECTANGLE,
    Inches(1), Inches(3), Inches(5), Pt(3)
)
connector.fill.solid()
connector.fill.fore_color.rgb = RGBColor(0xFF, 0x00, 0x00)
connector.line.fill.background()  # No border

# No fill (transparent shape)
shape = slide.shapes.add_shape(
    MSO_SHAPE.RECTANGLE,
    Inches(1), Inches(1), Inches(3), Inches(2)
)
shape.fill.background()  # Transparent

# Rounded rectangle
shape = slide.shapes.add_shape(
    MSO_SHAPE.ROUNDED_RECTANGLE,
    Inches(1), Inches(1), Inches(3), Inches(2)
)
shape.fill.solid()
shape.fill.fore_color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
```

### Shadow (via XML)

```python
from pptx.oxml.ns import qn
from lxml import etree

shape = slide.shapes.add_shape(
    MSO_SHAPE.RECTANGLE,
    Inches(1), Inches(1), Inches(3), Inches(2)
)
shape.fill.solid()
shape.fill.fore_color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

# Add outer shadow via XML
spPr = shape._element.spPr
effectLst = spPr.find(qn('a:effectLst'))
if effectLst is None:
    effectLst = etree.SubElement(spPr, qn('a:effectLst'))
outerShdw = etree.SubElement(effectLst, qn('a:outerShdw'))
outerShdw.set('blurRad', '76200')    # blur in EMUs (6pt = 76200)
outerShdw.set('dist', '25400')       # offset in EMUs (2pt = 25400)
outerShdw.set('dir', '8100000')      # angle in 60000ths of degree (135° = 8100000)
srgbClr = etree.SubElement(outerShdw, qn('a:srgbClr'))
srgbClr.set('val', '000000')
alpha = etree.SubElement(srgbClr, qn('a:alpha'))
alpha.set('val', '15000')  # 15% opacity (value in 1000ths of percent)
```

**EMU conversion:** 1 inch = 914400 EMUs, 1 pt = 12700 EMUs.

**Angle conversion:** Multiply degrees by 60000 (e.g., 135° = 8100000, 270° = 16200000).

### Fill Transparency (via XML)

```python
shape.fill.solid()
shape.fill.fore_color.rgb = RGBColor(0x00, 0x88, 0xCC)

# Set 50% transparency
solidFill = shape._element.spPr.find(qn('a:solidFill'))
srgbClr = solidFill.find(qn('a:srgbClr'))
alpha = etree.SubElement(srgbClr, qn('a:alpha'))
alpha.set('val', '50000')  # 50% in 1000ths of percent
```

---

## Images

```python
from pptx.util import Inches

# From file path
slide.shapes.add_picture('images/chart.png', Inches(1), Inches(1), Inches(5), Inches(3))

# From file-like object (e.g., downloaded from URL)
import requests
from io import BytesIO

resp = requests.get('https://example.com/image.jpg')
image_stream = BytesIO(resp.content)
slide.shapes.add_picture(image_stream, Inches(1), Inches(1), Inches(5), Inches(3))

# From base64
import base64
image_data = base64.b64decode(base64_string)
image_stream = BytesIO(image_data)
slide.shapes.add_picture(image_stream, Inches(1), Inches(1), Inches(5), Inches(3))
```

### Preserve Aspect Ratio

```python
from PIL import Image

img = Image.open('image.png')
orig_width, orig_height = img.size
max_height = Inches(3)
calc_width = max_height * (orig_width / orig_height)
center_x = (Inches(10) - calc_width) / 2

slide.shapes.add_picture('image.png', center_x, Inches(1.2), calc_width, max_height)
```

### Supported Formats

- **Standard**: PNG, JPG, GIF, BMP, TIFF
- **EMF/WMF**: Windows metafiles

---

## Slide Backgrounds

```python
from pptx.dml.color import RGBColor
from pptx.oxml.ns import qn
from lxml import etree

# Solid color background
background = slide.background
fill = background.fill
fill.solid()
fill.fore_color.rgb = RGBColor(0xF1, 0xF1, 0xF1)

# Image background
from pptx.util import Emu

slide_width = pres.slide_width
slide_height = pres.slide_height
pic = slide.shapes.add_picture('bg.jpg', 0, 0, slide_width, slide_height)
# Send to back
slide.shapes._spTree.remove(pic._element)
slide.shapes._spTree.insert(2, pic._element)
```

---

## Tables

```python
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

# Basic table
rows, cols = 3, 3
table_shape = slide.shapes.add_table(rows, cols, Inches(1), Inches(1), Inches(8), Inches(2))
table = table_shape.table

# Set cell content
table.cell(0, 0).text = "Header 1"
table.cell(0, 1).text = "Header 2"
table.cell(0, 2).text = "Header 3"
table.cell(1, 0).text = "Cell 1"
table.cell(1, 1).text = "Cell 2"
table.cell(1, 2).text = "Cell 3"

# Style header row
for col in range(cols):
    cell = table.cell(0, col)
    cell.fill.solid()
    cell.fill.fore_color.rgb = RGBColor(0x66, 0x99, 0xCC)
    for paragraph in cell.text_frame.paragraphs:
        paragraph.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        paragraph.font.bold = True

# Column widths
table.columns[0].width = Inches(2)
table.columns[1].width = Inches(3)
table.columns[2].width = Inches(3)

# Merge cells
table.cell(2, 0).merge(table.cell(2, 2))
table.cell(2, 0).text = "Merged cell"
```

---

## Charts

```python
from pptx.chart.data import CategoryChartData, ChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

# Bar chart
chart_data = CategoryChartData()
chart_data.categories = ['Q1', 'Q2', 'Q3', 'Q4']
chart_data.add_series('Sales', (4500, 5500, 6200, 7100))

chart_frame = slide.shapes.add_chart(
    XL_CHART_TYPE.COLUMN_CLUSTERED,
    Inches(0.5), Inches(0.6), Inches(6), Inches(3),
    chart_data
)
chart = chart_frame.chart
chart.has_title = True
chart.chart_title.text_frame.text = 'Quarterly Sales'

# Line chart
chart_data = CategoryChartData()
chart_data.categories = ['Jan', 'Feb', 'Mar']
chart_data.add_series('Temp', (32, 35, 42))

chart_frame = slide.shapes.add_chart(
    XL_CHART_TYPE.LINE,
    Inches(0.5), Inches(4), Inches(6), Inches(3),
    chart_data
)
chart = chart_frame.chart
chart.series[0].smooth = True

# Pie chart
chart_data = CategoryChartData()
chart_data.categories = ['A', 'B', 'Other']
chart_data.add_series('Share', (35, 45, 20))

chart_frame = slide.shapes.add_chart(
    XL_CHART_TYPE.PIE,
    Inches(7), Inches(1), Inches(5), Inches(4),
    chart_data
)
chart = chart_frame.chart
chart.plots[0].has_data_labels = True
data_labels = chart.plots[0].data_labels
data_labels.number_format = '0%'
data_labels.show_percentage = True
```

### Better-Looking Charts

```python
from pptx.oxml.ns import qn
from lxml import etree

chart_data = CategoryChartData()
chart_data.categories = ['Q1', 'Q2', 'Q3', 'Q4']
chart_data.add_series('Revenue', (4500, 5500, 6200, 7100))

chart_frame = slide.shapes.add_chart(
    XL_CHART_TYPE.COLUMN_CLUSTERED,
    Inches(0.5), Inches(1), Inches(9), Inches(4),
    chart_data
)
chart = chart_frame.chart

# Custom series color
series = chart.series[0]
series.format.fill.solid()
series.format.fill.fore_color.rgb = RGBColor(0x0D, 0x94, 0x88)

# Data labels
plot = chart.plots[0]
plot.has_data_labels = True
data_labels = plot.data_labels
data_labels.font.size = Pt(10)
data_labels.font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)
data_labels.number_format = '#,##0'

# Axis styling
category_axis = chart.category_axis
category_axis.tick_labels.font.size = Pt(10)
category_axis.tick_labels.font.color.rgb = RGBColor(0x64, 0x74, 0x8B)
category_axis.has_major_gridlines = False

value_axis = chart.value_axis
value_axis.tick_labels.font.size = Pt(10)
value_axis.tick_labels.font.color.rgb = RGBColor(0x64, 0x74, 0x8B)
value_axis.major_gridlines.format.line.color.rgb = RGBColor(0xE2, 0xE8, 0xF0)
value_axis.major_gridlines.format.line.width = Pt(0.5)

# Hide legend for single series
chart.has_legend = False
```

**Chart types available:**
- `XL_CHART_TYPE.COLUMN_CLUSTERED` — vertical bar
- `XL_CHART_TYPE.BAR_CLUSTERED` — horizontal bar
- `XL_CHART_TYPE.LINE` — line
- `XL_CHART_TYPE.PIE` — pie
- `XL_CHART_TYPE.DOUGHNUT` — doughnut
- `XL_CHART_TYPE.XY_SCATTER` — scatter
- `XL_CHART_TYPE.RADAR` — radar
- `XL_CHART_TYPE.AREA` — area

**Legend positions:** `XL_LEGEND_POSITION.BOTTOM`, `TOP`, `LEFT`, `RIGHT`, `CORNER`

---

## Slide Masters & Layouts

```python
# Use existing slide layout
slide_layout = pres.slide_layouts[0]  # Title Slide
slide = pres.slides.add_slide(slide_layout)

# Access placeholders
for ph in slide.placeholders:
    print(f"Index: {ph.placeholder_format.idx}, Name: {ph.name}, Type: {ph.placeholder_format.type}")

# Set placeholder text
slide.placeholders[0].text = "My Title"
slide.placeholders[1].text = "Subtitle"
```

---

## Common Pitfalls

1. **Always use `Inches()`, `Pt()`, `Cm()`, or `Emu()` for dimensions** — raw numbers are EMUs and will produce unexpected results.
   ```python
   # ✅ CORRECT
   shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(1), Inches(3), Inches(2))
   # ❌ WRONG — raw numbers are treated as EMUs (extremely small)
   shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 1, 1, 3, 2)
   ```

2. **Use `RGBColor(r, g, b)` for colors** — pass integer values (0-255), not hex strings.
   ```python
   # ✅ CORRECT
   font.color.rgb = RGBColor(0xFF, 0x00, 0x00)
   # ❌ WRONG
   font.color.rgb = "FF0000"
   ```

3. **Save before uploading** — always call `pres.save()` before uploading to S3.

4. **Set `word_wrap = True`** on text frames to prevent text overflow.

5. **Use blank layout (index 6) for custom slides** — other layouts have placeholders that may interfere.

6. **XML manipulation requires `lxml`** — for features not directly supported by python-pptx (shadows, transparency, bullets), use `from pptx.oxml.ns import qn` and `from lxml import etree`.

7. **Paragraphs[0] always exists** — a new text frame always has one empty paragraph. Use it before calling `add_paragraph()`.
   ```python
   tf = txBox.text_frame
   tf.paragraphs[0].text = "First line"  # ✅ Use existing paragraph
   p2 = tf.add_paragraph()
   p2.text = "Second line"
   ```

8. **Font properties are per-run, not per-paragraph** — set font on `paragraph.font` only as a shortcut for single-run paragraphs. For multi-run paragraphs, set font on each `run.font`.

---

## Quick Reference

- **Shapes**: `MSO_SHAPE.RECTANGLE`, `OVAL`, `ROUNDED_RECTANGLE`, `DIAMOND`, `CHEVRON`, etc.
- **Charts**: `XL_CHART_TYPE.COLUMN_CLUSTERED`, `BAR_CLUSTERED`, `LINE`, `PIE`, `DOUGHNUT`, `XY_SCATTER`, `RADAR`, `AREA`
- **Alignment**: `PP_ALIGN.LEFT`, `CENTER`, `RIGHT`, `JUSTIFY`
- **Vertical Align**: `MSO_ANCHOR.TOP`, `MIDDLE`, `BOTTOM`
- **Units**: `Inches(n)`, `Pt(n)`, `Cm(n)`, `Emu(n)`
- **EMU conversions**: 1 inch = 914400, 1 pt = 12700, 1 cm = 360000
