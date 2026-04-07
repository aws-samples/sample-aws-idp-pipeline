---
name: xlsx
description: "Excel spreadsheet (.xlsx) creation, editing, reading, and manipulation skill. Use when the user wants to create, read, edit, or manipulate Excel spreadsheets (.xlsx, .xlsm, .csv, .tsv files). Triggers include: any mention of 'spreadsheet', 'Excel', '.xlsx', or requests for tabular data deliverables. Also for adding columns, computing formulas, formatting, charting, cleaning messy data, or converting between tabular file formats. When an S3 URI with .xlsx extension is provided. Do NOT use for PDFs, Word documents, or Google Sheets."
---

# XLSX creation, editing, and analysis

## Execution Rules

- **ALL code execution MUST use the `code_interpreter` tool.** Do NOT use the `shell` tool.
- **Generate the COMPLETE spreadsheet and upload to S3 in a SINGLE `code_interpreter` call.** Do NOT split into multiple calls.
- Before calling `code_interpreter`, call `artifact_path(filename="spreadsheet.xlsx")` to get the S3 bucket and key.
- After completion, report the `artifact_ref` to the user.
- **If `code_interpreter` fails with an error, do NOT retry automatically.** Report the error to the user and ask for clarification or guidance. Do not make multiple retry attempts without user input.

### Workflow

1. Call `artifact_path(filename="spreadsheet.xlsx")` — returns `{ s3_uri, bucket, key, artifact_ref }`
2. **Copy the actual `s3_uri` string value** from the artifact_path result and **hardcode it as a string literal** in your code_interpreter script. Do NOT use variable references — the code_interpreter runs in an isolated sandbox and cannot access the agent's tool results.
3. Call `code_interpreter` ONCE with a single script that does everything: create the spreadsheet, save it, and upload to S3.

```python
!pip install openpyxl

from openpyxl import Workbook
import boto3

# IMPORTANT: Replace with the ACTUAL s3_uri value returned by artifact_path
S3_URI = "s3://my-bucket/user123/proj456/artifacts/art_abc123/spreadsheet.xlsx"  # ← paste the actual s3_uri here

# Parse S3 URI into bucket and key
BUCKET, KEY = S3_URI.replace("s3://", "").split("/", 1)

# Build entire spreadsheet
wb = Workbook()
# ... all spreadsheet content ...
wb.save('./output.xlsx')

# Upload to S3
s3 = boto3.client('s3')
with open('./output.xlsx', 'rb') as f:
    s3.upload_fileobj(
        f, BUCKET, KEY,
        ExtraArgs={'ContentType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
    )
```
4. Report the `artifact_ref` to the user

---

## Quick Reference

| Task | Approach |
|------|----------|
| Read/analyze content | Download from S3 → `pandas` or `openpyxl` in code_interpreter |
| Create new spreadsheet | Use `openpyxl` in code_interpreter |
| Edit existing spreadsheet | Download from S3 → `openpyxl` → edit → upload in code_interpreter |

## Charts

**When the user requests charts or visualizations, always attempt to embed charts directly using `openpyxl` first.** Only use the `chart` skill if direct embedding is not possible or the chart type is unsupported by openpyxl.

```python
from openpyxl.chart import BarChart, Reference

chart = BarChart()
data = Reference(sheet, min_col=2, min_row=1, max_row=5)
chart.add_data(data, titles_from_data=True)
sheet.add_chart(chart, "E2")
```

### Chart QA — Overlap Detection

After generating the file, run this check to catch overlapping charts before uploading:

```python
from openpyxl import load_workbook
from openpyxl.drawing.spreadsheet_drawing import TwoCellAnchor, OneCellAnchor

# Approximate EMU per default cell (column width ~8.43 chars, row height ~15pt)
EMU_PER_COL = 600000
EMU_PER_ROW = 190500

def _bounds(anchor):
    if isinstance(anchor, TwoCellAnchor):
        return (anchor._from.col, anchor._from.row, anchor.to.col, anchor.to.row)
    if isinstance(anchor, OneCellAnchor):
        c, r = anchor._from.col, anchor._from.row
        return (c, r, c + round(anchor.ext.cx / EMU_PER_COL), r + round(anchor.ext.cy / EMU_PER_ROW))
    return None

def _overlaps(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])

wb = load_workbook('./output.xlsx')
issues = []
for ws in wb.worksheets:
    bounds = [(c, _bounds(c.anchor)) for c in ws._charts]
    bounds = [(c, b) for c, b in bounds if b]
    for i, (_, b1) in enumerate(bounds):
        for _, b2 in bounds[i+1:]:
            if _overlaps(b1, b2):
                issues.append(f"Sheet '{ws.title}': chart overlap {b1} ↔ {b2}")

if issues:
    for issue in issues:
        print(f"OVERLAP: {issue}")
    raise ValueError("Fix chart positions before uploading")
else:
    print("OK: no chart overlaps")
```

If overlaps are detected, adjust the anchor cell or set an explicit size:

```python
from openpyxl.drawing.spreadsheet_drawing import TwoCellAnchor
from openpyxl.drawing.xdr import XDRPoint2D, XDRPositiveSize2D
from openpyxl.utils.units import pixels_to_EMU

# Place chart at E2, spanning to O17 (no overlap with next chart starting at E19)
chart.anchor = "E2:O17"
```

---

# Requirements for Outputs

## All Excel files

### Professional Font
- Use a consistent, professional font (e.g., Arial, Times New Roman) for all deliverables unless otherwise instructed by the user

### Zero Formula Errors
- Every Excel model MUST be delivered with ZERO formula errors (#REF!, #DIV/0!, #VALUE!, #N/A, #NAME?)

### Preserve Existing Templates (when updating templates)
- Study and EXACTLY match existing format, style, and conventions when modifying files
- Never impose standardized formatting on files with established patterns
- Existing template conventions ALWAYS override these guidelines

## Financial models

### Color Coding Standards
Unless otherwise stated by the user or existing template

#### Industry-Standard Color Conventions
- **Blue text (RGB: 0,0,255)**: Hardcoded inputs, and numbers users will change for scenarios
- **Black text (RGB: 0,0,0)**: ALL formulas and calculations
- **Green text (RGB: 0,128,0)**: Links pulling from other worksheets within same workbook
- **Red text (RGB: 255,0,0)**: External links to other files
- **Yellow background (RGB: 255,255,0)**: Key assumptions needing attention or cells that need to be updated

### Number Formatting Standards

#### Required Format Rules
- **Years**: Format as text strings (e.g., "2024" not "2,024")
- **Currency**: Use $#,##0 format; ALWAYS specify units in headers ("Revenue ($mm)")
- **Zeros**: Use number formatting to make all zeros "-", including percentages (e.g., "$#,##0;($#,##0);-")
- **Percentages**: Default to 0.0% format (one decimal)
- **Multiples**: Format as 0.0x for valuation multiples (EV/EBITDA, P/E)
- **Negative numbers**: Use parentheses (123) not minus -123

### Formula Construction Rules

#### Assumptions Placement
- Place ALL assumptions (growth rates, margins, multiples, etc.) in separate assumption cells
- Use cell references instead of hardcoded values in formulas
- Example: Use =B5*(1+$B$6) instead of =B5*1.05

#### Formula Error Prevention
- Verify all cell references are correct
- Check for off-by-one errors in ranges
- Ensure consistent formulas across all projection periods
- Test with edge cases (zero values, negative numbers)
- Verify no unintended circular references

## Reading and analyzing data

Read .xlsx files by downloading from the given S3 path and using tools in `code_interpreter`.

### Data analysis with pandas

```python
!pip install pandas openpyxl

import boto3
import pandas as pd

s3 = boto3.client('s3')
s3.download_file(bucket, key, 'spreadsheet.xlsx')

df = pd.read_excel('spreadsheet.xlsx')  # Default: first sheet
all_sheets = pd.read_excel('spreadsheet.xlsx', sheet_name=None)  # All sheets as dict

df.head()      # Preview data
df.info()      # Column info
df.describe()  # Statistics
```

## Excel File Workflows

## CRITICAL: Use Formulas, Not Hardcoded Values

**Always use Excel formulas instead of calculating values in Python and hardcoding them.** This ensures the spreadsheet remains dynamic and updateable.

### ❌ WRONG - Hardcoding Calculated Values
```python
total = df['Sales'].sum()
sheet['B10'] = total  # Hardcodes 5000

growth = (df.iloc[-1]['Revenue'] - df.iloc[0]['Revenue']) / df.iloc[0]['Revenue']
sheet['C5'] = growth  # Hardcodes 0.15
```

### ✅ CORRECT - Using Excel Formulas
```python
sheet['B10'] = '=SUM(B2:B9)'
sheet['C5'] = '=(C4-C2)/C2'
```

Formulas are stored as strings by openpyxl and recalculated automatically when the user opens the file in Excel or LibreOffice Calc.

## Common Workflow
1. **Choose tool**: pandas for data, openpyxl for formulas/formatting
2. **Create/Load**: Create new workbook or load existing file
3. **Modify**: Add/edit data, formulas, and formatting
4. **Save**: Write to file
5. **Upload**: Upload to S3

### Creating new Excel files

```python
!pip install openpyxl

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
import boto3

wb = Workbook()
sheet = wb.active

sheet['A1'] = 'Hello'
sheet['B1'] = 'World'
sheet.append(['Row', 'of', 'data'])

sheet['B2'] = '=SUM(A1:A10)'

sheet['A1'].font = Font(bold=True, color='FF0000')
sheet['A1'].fill = PatternFill('solid', start_color='FFFF00')
sheet['A1'].alignment = Alignment(horizontal='center')

sheet.column_dimensions['A'].width = 20

wb.save('./output.xlsx')

# Upload to S3
s3 = boto3.client('s3')
with open('./output.xlsx', 'rb') as f:
    s3.upload_fileobj(
        f, BUCKET, KEY,
        ExtraArgs={'ContentType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
    )
```

### Editing existing Excel files

```python
!pip install openpyxl

from openpyxl import load_workbook
import boto3

# Download from S3
s3 = boto3.client('s3')
s3.download_file(bucket, key, 'existing.xlsx')

wb = load_workbook('existing.xlsx')
sheet = wb.active  # or wb['SheetName'] for specific sheet

for sheet_name in wb.sheetnames:
    sheet = wb[sheet_name]

sheet['A1'] = 'New Value'
sheet.insert_rows(2)
sheet.delete_cols(3)

new_sheet = wb.create_sheet('NewSheet')
new_sheet['A1'] = 'Data'

wb.save('./modified.xlsx')

# Upload to S3
with open('./modified.xlsx', 'rb') as f:
    s3.upload_fileobj(
        f, BUCKET, KEY,
        ExtraArgs={'ContentType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
    )
```

## Best Practices

### Library Selection
- **pandas**: Best for data analysis, bulk operations, and simple data export
- **openpyxl**: Best for complex formatting, formulas, and Excel-specific features

### Working with openpyxl
- Cell indices are 1-based (row=1, column=1 refers to cell A1)
- Use `data_only=True` to read cached values from existing files: `load_workbook('file.xlsx', data_only=True)`
- **Note**: openpyxl-generated files do not have cached formula values — formulas recalculate when opened in Excel/LibreOffice Calc
- For large files: Use `read_only=True` for reading or `write_only=True` for writing

### Working with pandas
- Specify data types to avoid inference issues: `pd.read_excel('file.xlsx', dtype={'id': str})`
- For large files, read specific columns: `pd.read_excel('file.xlsx', usecols=['A', 'C', 'E'])`
- Handle dates properly: `pd.read_excel('file.xlsx', parse_dates=['date_column'])`

## Code Style Guidelines
**IMPORTANT**: When generating Python code for Excel operations:
- Write minimal, concise Python code without unnecessary comments
- Avoid verbose variable names and redundant operations
- Avoid unnecessary print statements

**For Excel files themselves**:
- Document data sources for hardcoded values
- Include notes for key calculations and model sections

---

## Dependencies

All dependencies should be installed within code_interpreter:
```python
!pip install openpyxl
!pip install pandas
```