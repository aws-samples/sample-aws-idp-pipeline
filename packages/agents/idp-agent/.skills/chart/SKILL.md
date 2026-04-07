---
name: chart
description: "Data chart and graph creation skill using Matplotlib. Use when the user wants to create data visualizations — bar charts, line charts, pie charts, scatter plots, heatmaps, histograms, or any data-driven graph. Triggers include: any mention of 'chart', 'graph', 'plot', 'visualization', 'visualize', or requests to display data visually. Also when the user provides numeric data and asks to 'show' or 'compare' it. Do NOT use for diagrams (flowcharts, sequence diagrams, ER diagrams) — those belong to a diagram skill."
---

# Chart creation with Matplotlib

## Execution Rules

- **ALL code execution MUST use the `code_interpreter` tool.** Do NOT use the `shell` tool.
- **Generate the chart and upload to S3 in a SINGLE `code_interpreter` call.** Do NOT split into multiple calls.
- Before calling `code_interpreter`, call `artifact_path(filename="chart.png")` to get the S3 bucket and key.
- After completion, report the `artifact_ref` to the user.
- **If `code_interpreter` fails with an error, do NOT retry automatically.** Report the error to the user and ask for clarification or guidance.

### Workflow

1. Call `artifact_path(filename="chart.png")` — returns `{ s3_uri, bucket, key, artifact_ref }`
2. **Copy the actual `s3_uri` string value** from the artifact_path result and **hardcode it as a string literal** in your code_interpreter script. Do NOT use variable references — the code_interpreter runs in an isolated sandbox and cannot access the agent's tool results.
3. Call `code_interpreter` ONCE with a single script that creates the chart, saves it, and uploads to S3.

```python
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import boto3

# IMPORTANT: Replace with the ACTUAL s3_uri value returned by artifact_path
S3_URI = "s3://my-bucket/user123/proj456/artifacts/art_abc123/chart.png"  # <- paste the actual s3_uri here

# Parse S3 URI into bucket and key
BUCKET, KEY = S3_URI.replace("s3://", "").split("/", 1)

# Create chart
fig, ax = plt.subplots(figsize=(10, 6))
# ... build chart ...
fig.savefig('./chart.png', dpi=150, bbox_inches='tight', facecolor='white')
plt.close(fig)

# Upload to S3
s3 = boto3.client('s3')
with open('./chart.png', 'rb') as f:
    s3.upload_fileobj(
        f, BUCKET, KEY,
        ExtraArgs={'ContentType': 'image/png'}
    )
```
4. Report the `artifact_ref` to the user

---

## Headless Setup (Required)

The code_interpreter has no display. Always set the `Agg` backend **before** importing pyplot:

```python
import matplotlib
matplotlib.use('Agg')  # MUST be before importing pyplot
import matplotlib.pyplot as plt
```

Always use `fig.savefig()` — never call `plt.show()`.
Always call `plt.close(fig)` after saving to free memory.

---

## Chart Types

### Bar Chart

```python
fig, ax = plt.subplots(figsize=(10, 6))

categories = ['Q1', 'Q2', 'Q3', 'Q4']
values = [4500, 5500, 6200, 7100]
colors = ['#2196F3', '#4CAF50', '#FF9800', '#E91E63']

bars = ax.bar(categories, values, color=colors, width=0.6, edgecolor='white', linewidth=0.5)

# Add value labels on bars
for bar, val in zip(bars, values):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 100,
            f'{val:,}', ha='center', va='bottom', fontsize=11, fontweight='bold')

ax.set_title('Quarterly Revenue', fontsize=16, fontweight='bold', pad=15)
ax.set_ylabel('Revenue ($)', fontsize=12)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'${x:,.0f}'))
```

### Horizontal Bar Chart

```python
fig, ax = plt.subplots(figsize=(10, 6))

categories = ['Product A', 'Product B', 'Product C', 'Product D']
values = [320, 450, 280, 510]

bars = ax.barh(categories, values, color='#2196F3', height=0.5)

for bar, val in zip(bars, values):
    ax.text(val + 5, bar.get_y() + bar.get_height()/2,
            f'{val}', va='center', fontsize=11)

ax.set_title('Sales by Product', fontsize=16, fontweight='bold')
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.invert_yaxis()
```

### Grouped Bar Chart

```python
import numpy as np

fig, ax = plt.subplots(figsize=(10, 6))

categories = ['Q1', 'Q2', 'Q3', 'Q4']
series1 = [300, 400, 350, 500]
series2 = [250, 350, 400, 450]

x = np.arange(len(categories))
width = 0.35

ax.bar(x - width/2, series1, width, label='2024', color='#2196F3')
ax.bar(x + width/2, series2, width, label='2025', color='#FF9800')

ax.set_xticks(x)
ax.set_xticklabels(categories)
ax.legend()
ax.set_title('Year-over-Year Comparison', fontsize=16, fontweight='bold')
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
```

### Line Chart

```python
fig, ax = plt.subplots(figsize=(10, 6))

months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
values = [120, 135, 148, 162, 155, 178]

ax.plot(months, values, color='#2196F3', linewidth=2.5, marker='o', markersize=8)
ax.fill_between(range(len(months)), values, alpha=0.1, color='#2196F3')

ax.set_title('Monthly Growth', fontsize=16, fontweight='bold', pad=15)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.grid(axis='y', alpha=0.3)
```

### Multi-Line Chart

```python
fig, ax = plt.subplots(figsize=(10, 6))

months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
line1 = [120, 135, 148, 162, 155, 178]
line2 = [100, 115, 130, 140, 150, 160]

ax.plot(months, line1, color='#2196F3', linewidth=2.5, marker='o', label='Product A')
ax.plot(months, line2, color='#E91E63', linewidth=2.5, marker='s', label='Product B')

ax.legend(frameon=False)
ax.set_title('Product Comparison', fontsize=16, fontweight='bold')
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.grid(axis='y', alpha=0.3)
```

### Pie Chart

```python
fig, ax = plt.subplots(figsize=(8, 8))

labels = ['Product A', 'Product B', 'Product C', 'Other']
sizes = [35, 30, 20, 15]
colors = ['#2196F3', '#4CAF50', '#FF9800', '#9E9E9E']
explode = (0.05, 0, 0, 0)  # Slightly pull out the largest slice

wedges, texts, autotexts = ax.pie(
    sizes, labels=labels, colors=colors, explode=explode,
    autopct='%1.0f%%', startangle=90,
    textprops={'fontsize': 12}
)
for autotext in autotexts:
    autotext.set_fontweight('bold')

ax.set_title('Market Share', fontsize=16, fontweight='bold', pad=20)
```

### Donut Chart

```python
fig, ax = plt.subplots(figsize=(8, 8))

labels = ['Complete', 'In Progress', 'Pending']
sizes = [65, 20, 15]
colors = ['#4CAF50', '#FF9800', '#E0E0E0']

wedges, texts, autotexts = ax.pie(
    sizes, labels=labels, colors=colors,
    autopct='%1.0f%%', startangle=90, pctdistance=0.8,
    wedgeprops=dict(width=0.4)
)

# Center label
ax.text(0, 0, '65%', ha='center', va='center', fontsize=28, fontweight='bold', color='#4CAF50')
ax.text(0, -0.12, 'Complete', ha='center', va='center', fontsize=12, color='#666666')
```

### Scatter Plot

```python
import numpy as np

fig, ax = plt.subplots(figsize=(10, 6))

np.random.seed(42)
x = np.random.randn(100) * 10 + 50
y = x * 0.8 + np.random.randn(100) * 5
sizes = np.random.randint(20, 200, 100)

scatter = ax.scatter(x, y, s=sizes, c=y, cmap='viridis', alpha=0.7, edgecolors='white', linewidth=0.5)
fig.colorbar(scatter, ax=ax, label='Value')

ax.set_title('Scatter Analysis', fontsize=16, fontweight='bold')
ax.set_xlabel('Variable X', fontsize=12)
ax.set_ylabel('Variable Y', fontsize=12)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
```

### Heatmap

```python
import numpy as np

fig, ax = plt.subplots(figsize=(10, 8))

data = np.random.rand(6, 8)
row_labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
col_labels = ['9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm']

im = ax.imshow(data, cmap='YlOrRd', aspect='auto')
fig.colorbar(im, ax=ax)

ax.set_xticks(range(len(col_labels)))
ax.set_yticks(range(len(row_labels)))
ax.set_xticklabels(col_labels)
ax.set_yticklabels(row_labels)

# Add value labels
for i in range(len(row_labels)):
    for j in range(len(col_labels)):
        color = 'white' if data[i, j] > 0.6 else 'black'
        ax.text(j, i, f'{data[i,j]:.1f}', ha='center', va='center', color=color, fontsize=9)

ax.set_title('Activity Heatmap', fontsize=16, fontweight='bold', pad=15)
```

### Histogram

```python
import numpy as np

fig, ax = plt.subplots(figsize=(10, 6))

np.random.seed(42)
data = np.random.normal(100, 15, 1000)

ax.hist(data, bins=30, color='#2196F3', edgecolor='white', linewidth=0.5, alpha=0.8)
ax.axvline(np.mean(data), color='#E91E63', linestyle='--', linewidth=2, label=f'Mean: {np.mean(data):.1f}')

ax.set_title('Distribution', fontsize=16, fontweight='bold')
ax.set_xlabel('Value', fontsize=12)
ax.set_ylabel('Frequency', fontsize=12)
ax.legend(frameon=False)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
```

### Stacked Bar Chart

```python
import numpy as np

fig, ax = plt.subplots(figsize=(10, 6))

categories = ['Q1', 'Q2', 'Q3', 'Q4']
seg1 = [200, 250, 300, 350]
seg2 = [150, 180, 200, 220]
seg3 = [100, 120, 140, 160]

ax.bar(categories, seg1, label='Segment A', color='#2196F3')
ax.bar(categories, seg2, bottom=seg1, label='Segment B', color='#4CAF50')
ax.bar(categories, seg3, bottom=np.array(seg1)+np.array(seg2), label='Segment C', color='#FF9800')

ax.set_title('Revenue Breakdown', fontsize=16, fontweight='bold')
ax.legend(frameon=False)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
```

---

## Styling Guide

### Color Palettes

| Palette | Colors | Use Case |
|---------|--------|----------|
| **Professional Blue** | `#1565C0`, `#42A5F5`, `#90CAF9` | Business reports |
| **Traffic Light** | `#4CAF50`, `#FF9800`, `#F44336` | Status, good/warn/bad |
| **Warm** | `#E91E63`, `#FF5722`, `#FF9800`, `#FFC107` | Marketing, engagement |
| **Cool** | `#0D47A1`, `#1565C0`, `#1E88E5`, `#42A5F5` | Technology, finance |
| **Earth** | `#5D4037`, `#795548`, `#8D6E63`, `#A1887F` | Natural, organic themes |
| **Vibrant** | `#2196F3`, `#4CAF50`, `#FF9800`, `#E91E63` | General purpose |
| **Grayscale** | `#212121`, `#616161`, `#9E9E9E`, `#E0E0E0` | Print, formal docs |

### Typography

```python
# Title
ax.set_title('Chart Title', fontsize=16, fontweight='bold', pad=15)

# Axis labels
ax.set_xlabel('X Label', fontsize=12)
ax.set_ylabel('Y Label', fontsize=12)

# Tick labels
ax.tick_params(labelsize=10)

# Annotation
ax.annotate('Peak', xy=(x, y), fontsize=11, fontweight='bold',
            arrowprops=dict(arrowstyle='->', color='#333333'))
```

### Clean Style Rules

Apply these to every chart for a polished, professional look:

```python
# Remove top and right spines
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)

# Subtle gridlines (y-axis only for bar/line charts)
ax.grid(axis='y', alpha=0.3, linestyle='-', linewidth=0.5)

# White background
fig.patch.set_facecolor('white')
ax.set_facecolor('white')

# Tight layout to prevent label clipping
fig.tight_layout()
```

### Number Formatting

```python
# Currency
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'${x:,.0f}'))

# Percentage
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{x:.0f}%'))

# Thousands (K)
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{x/1000:.0f}K'))

# Millions (M)
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{x/1e6:.1f}M'))
```

---

## Multiple Charts (Subplots)

```python
fig, axes = plt.subplots(1, 3, figsize=(18, 6))

# Chart 1
axes[0].bar(['A', 'B', 'C'], [10, 20, 15], color='#2196F3')
axes[0].set_title('Bar Chart')

# Chart 2
axes[1].plot([1, 2, 3, 4], [10, 15, 12, 18], color='#4CAF50', marker='o')
axes[1].set_title('Line Chart')

# Chart 3
axes[2].pie([40, 30, 30], labels=['X', 'Y', 'Z'], colors=['#E91E63', '#FF9800', '#9E9E9E'])
axes[2].set_title('Pie Chart')

for ax in axes[:2]:
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)

fig.suptitle('Dashboard Overview', fontsize=18, fontweight='bold', y=1.02)
fig.tight_layout()
```

---

## Embedding in Other Documents

Charts created with this skill produce PNG images that can be embedded in:

- **PPTX** — use the pptx skill's `add_picture()` with the chart image
- **DOCX** — use the docx skill's `doc.add_picture()` with the chart image
- **Markdown** — use `![Chart description](image_url)` syntax

When creating charts for embedding, save the image locally first, then reference it in the parent document's code_interpreter script.

---

## Common Pitfalls

- **Always set `matplotlib.use('Agg')`** before importing pyplot — code_interpreter has no display
- **Never call `plt.show()`** — it does nothing in headless mode and may hang
- **Always call `plt.close(fig)`** after saving — prevents memory leaks
- **Use `bbox_inches='tight'`** in `savefig()` — prevents label clipping
- **Use `facecolor='white'`** in `savefig()` — default transparent background renders poorly in some viewers
- **Use `fig, ax = plt.subplots()`** over `plt.plot()` — explicit figure/axes gives more control
- **Import `numpy`** for any data manipulation — it's always available alongside matplotlib

---

## Dependencies

All dependencies should be installed within code_interpreter:
```python
!pip install matplotlib numpy
```
