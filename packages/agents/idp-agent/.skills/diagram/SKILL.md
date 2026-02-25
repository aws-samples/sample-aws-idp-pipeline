---
name: diagram
description: "Diagram creation skill using Mermaid syntax — flowcharts, sequence diagrams, ER diagrams, Gantt charts, mindmaps, and more."
whenToUse: "Use when the user wants to create structural or process diagrams — NOT data charts. Triggers include: 'flowchart', 'flow diagram', 'sequence diagram', 'ER diagram', 'entity relationship', 'class diagram', 'state diagram', 'Gantt chart', 'timeline', 'mindmap', 'architecture diagram', or any request to visualize processes, workflows, system interactions, or relationships. Also when the user mentions 'mermaid' or '.mmd'. Do NOT use for data-driven charts (bar, line, pie, scatter, heatmap) — those belong to the chart skill."
---

# Diagram creation with Mermaid

## Execution Rules

- **ALL code execution MUST use the `code_interpreter` tool.** Do NOT use the `shell` tool.
- **Generate the diagram and upload to S3 in a SINGLE `code_interpreter` call.** Do NOT split into multiple calls.
- Before calling `code_interpreter`, call `artifact_path(filename="diagram.png")` to get the S3 bucket and key.
- After completion, report the `artifact_ref` to the user.
- **If `code_interpreter` fails with an error, do NOT retry automatically.** Report the error to the user and ask for clarification or guidance.

### Workflow

1. Call `artifact_path(filename="diagram.png")` — returns `{ s3_uri, bucket, key, artifact_ref }`
2. **Copy the actual `s3_uri` string value** from the artifact_path result and **hardcode it as a string literal** in your code_interpreter script.
3. Call `code_interpreter` ONCE with a single script that writes the Mermaid definition, renders it to PNG, and uploads to S3.

```python
!pip install mmdc

import subprocess
import boto3

# IMPORTANT: Replace with the ACTUAL s3_uri value returned by artifact_path
S3_URI = "s3://my-bucket/user123/proj456/artifacts/art_abc123/diagram.png"  # <- paste the actual s3_uri here

# Parse S3 URI into bucket and key
BUCKET, KEY = S3_URI.replace("s3://", "").split("/", 1)

# Write Mermaid definition
mermaid_code = """
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E
"""

with open('diagram.mmd', 'w') as f:
    f.write(mermaid_code)

# Render to PNG
subprocess.run(['mmdc', '-i', 'diagram.mmd', '-o', 'diagram.png', '-s', '3', '-b', 'white'], check=True)

# Upload to S3
s3 = boto3.client('s3')
with open('./diagram.png', 'rb') as f:
    s3.upload_fileobj(
        f, BUCKET, KEY,
        ExtraArgs={'ContentType': 'image/png'}
    )
```
4. Report the `artifact_ref` to the user

---

## Rendering Options

```bash
mmdc -i diagram.mmd -o output.png -s 3 -b white       # PNG, 3x scale, white bg
mmdc -i diagram.mmd -o output.svg                       # SVG (vector)
mmdc -i diagram.mmd -o output.png -t dark -b transparent # Dark theme, transparent bg
```

| Flag | Description |
|------|-------------|
| `-i` | Input .mmd file |
| `-o` | Output file (.png, .svg, .pdf) |
| `-s` | Scale factor (default 1, use 2-3 for high-res PNG) |
| `-b` | Background color (`white`, `transparent`, `#F0F0F0`) |
| `-t` | Theme: `default`, `forest`, `dark`, `neutral` |
| `-w` | Width in pixels (default 800) |
| `-H` | Height in pixels (default 600) |

**Always use `-s 3 -b white`** for production PNG output — ensures high resolution and clean background.

---

## Diagram Types

### Flowchart

Best for: processes, decision trees, workflows, algorithms.

```mermaid
flowchart TD
    A[Start] --> B{Is it valid?}
    B -->|Yes| C[Process]
    B -->|No| D[Reject]
    C --> E[Save to DB]
    E --> F[Send notification]
    F --> G[End]
    D --> G
```

**Direction options:** `TD` (top-down), `LR` (left-right), `BT` (bottom-top), `RL` (right-left)

**Node shapes:**
```
[Rectangle]       — standard process
{Diamond}         — decision
([Stadium])       — terminal/start/end
[[Subroutine]]    — subprocess
[(Cylinder)]      — database
((Circle))        — connector
>Asymmetric]      — input/output
{Hexagon}         — preparation
```

**Link styles:**
```
A --> B           — solid arrow
A --- B           — solid line (no arrow)
A -.-> B          — dotted arrow
A ==> B           — thick arrow
A -->|label| B    — arrow with label
```

### Sequence Diagram

Best for: API flows, system interactions, request/response patterns, protocol exchanges.

```mermaid
sequenceDiagram
    participant U as User
    participant API as API Gateway
    participant S as Service
    participant DB as Database

    U->>API: POST /orders
    API->>S: validateOrder()
    S->>DB: INSERT order
    DB-->>S: order_id
    S-->>API: 201 Created
    API-->>U: { order_id: 123 }
```

**Arrow types:**
```
->>    solid arrow (sync request)
-->>   dotted arrow (async response)
-x     solid with X (failed/rejected)
--x    dotted with X
-)     solid open arrow
--)    dotted open arrow
```

**Features:**
```
Note right of A: Note text         — side note
Note over A,B: Shared note         — spanning note
alt condition                       — if/else
    A->>B: action
else other
    A->>B: other action
end
loop Every 5 min                    — loop
    A->>B: poll
end
par Parallel                        — parallel execution
    A->>B: task 1
and
    A->>C: task 2
end
rect rgb(200, 220, 255)             — highlight region
    A->>B: important step
end
```

### Class Diagram

Best for: object models, data structures, system design.

```mermaid
classDiagram
    class User {
        +String name
        +String email
        +login()
        +logout()
    }
    class Order {
        +int id
        +Date createdAt
        +calculateTotal()
    }
    class Product {
        +String name
        +float price
    }

    User "1" --> "*" Order : places
    Order "*" --> "*" Product : contains
```

**Relationships:**
```
A <|-- B    inheritance
A *-- B     composition
A o-- B     aggregation
A --> B     association
A ..> B     dependency
A ..|> B    realization
```

**Cardinality:** `"1"`, `"0..1"`, `"*"`, `"1..*"`, `"0..*"`

### Entity Relationship (ER) Diagram

Best for: database schemas, data models.

```mermaid
erDiagram
    USER {
        int id PK
        string name
        string email UK
        datetime created_at
    }
    ORDER {
        int id PK
        int user_id FK
        decimal total
        string status
    }
    ORDER_ITEM {
        int id PK
        int order_id FK
        int product_id FK
        int quantity
    }
    PRODUCT {
        int id PK
        string name
        decimal price
    }

    USER ||--o{ ORDER : places
    ORDER ||--|{ ORDER_ITEM : contains
    PRODUCT ||--o{ ORDER_ITEM : "included in"
```

**Relationship notation:**
```
||--||    one to one
||--o{    one to zero-or-many
||--|{    one to one-or-many
o{--o{    many to many
```

### Gantt Chart

Best for: project timelines, sprint planning, milestones.

```mermaid
gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Phase 1
    Research           :a1, 2026-01-01, 14d
    Design             :a2, after a1, 10d
    Prototype          :a3, after a2, 7d

    section Phase 2
    Development        :b1, after a3, 30d
    Testing            :b2, after b1, 14d

    section Launch
    Deployment         :milestone, after b2, 0d
    Monitoring         :c1, after b2, 7d
```

**Task types:**
```
Task name    :id, start_date, duration     — normal task
Task name    :active, id, start, duration  — active (highlighted)
Task name    :done, id, start, duration    — completed
Task name    :crit, id, start, duration    — critical path
Task name    :milestone, after id, 0d      — milestone
```

### State Diagram

Best for: state machines, status flows, lifecycle models.

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Review : submit
    Review --> Approved : approve
    Review --> Draft : reject
    Approved --> Published : publish
    Published --> Archived : archive
    Archived --> [*]

    state Review {
        [*] --> Pending
        Pending --> InReview : assign
        InReview --> Pending : request_changes
        InReview --> [*] : complete
    }
```

### Mindmap

Best for: brainstorming, topic hierarchies, concept maps.

```mermaid
mindmap
    root((Project))
        Frontend
            React
            TypeScript
            Tailwind CSS
        Backend
            Python
            FastAPI
            PostgreSQL
        Infrastructure
            AWS
            Docker
            Terraform
        Team
            2 Frontend devs
            3 Backend devs
            1 DevOps
```

### Timeline

Best for: historical events, version history, roadmaps.

```mermaid
timeline
    title Product Roadmap
    section Q1 2026
        MVP Launch : Core features
                   : Basic UI
    section Q2 2026
        v2.0 : API integration
             : Mobile support
    section Q3 2026
        Enterprise : SSO
                   : Audit logs
                   : Admin panel
```

---

## Styling

### Built-in Themes

| Theme | Description |
|-------|-------------|
| `default` | Clean, standard colors |
| `forest` | Green tones, organic feel |
| `dark` | Dark background, light text |
| `neutral` | Grayscale, minimal |

### Custom Styling (in Mermaid syntax)

```mermaid
flowchart TD
    A[Start]:::primary --> B{Decision}:::warning
    B -->|Yes| C[Success]:::success
    B -->|No| D[Error]:::danger

    classDef primary fill:#2196F3,stroke:#1565C0,color:#fff
    classDef success fill:#4CAF50,stroke:#2E7D32,color:#fff
    classDef warning fill:#FF9800,stroke:#E65100,color:#fff
    classDef danger fill:#F44336,stroke:#C62828,color:#fff
```

### Style via Config File

```python
import json

config = {
    "theme": "default",
    "themeVariables": {
        "primaryColor": "#2196F3",
        "primaryTextColor": "#ffffff",
        "primaryBorderColor": "#1565C0",
        "lineColor": "#333333",
        "secondaryColor": "#4CAF50",
        "tertiaryColor": "#FF9800",
        "fontSize": "14px"
    }
}

with open('mermaid-config.json', 'w') as f:
    json.dump(config, f)

# Then render with config
subprocess.run(['mmdc', '-i', 'diagram.mmd', '-o', 'diagram.png', '-c', 'mermaid-config.json', '-s', '3', '-b', 'white'])
```

---

## Embedding in Other Documents

Diagrams render to PNG images that can be embedded in:

- **PPTX** — use the pptx skill's `add_picture()` with the diagram image
- **DOCX** — use the docx skill's `doc.add_picture()` with the diagram image
- **Markdown** — embed mermaid code blocks directly (renderers support it), or use image reference `![Diagram](image_url)`

---

## Common Pitfalls

- **Always use `-s 3`** for PNG output — default scale produces blurry images
- **Use `-b white`** for document embedding — transparent backgrounds render poorly in some contexts
- **Keep diagrams focused** — split complex systems into multiple diagrams rather than one massive diagram
- **Test syntax incrementally** — Mermaid syntax errors are hard to debug in large diagrams
- **Use `participant` aliases** in sequence diagrams — `participant U as User` keeps the diagram readable
- **Direction matters** — `LR` (left-right) works better for wide processes, `TD` (top-down) for hierarchical structures
- **Quote special characters** — labels with special characters need quotes: `A["Label with (parens)"]`

---

## Dependencies

All dependencies should be installed within code_interpreter:
```python
!pip install mmdc
```

If `mmdc` Python package is not available, use Node.js alternative:
```python
!npm install -g @mermaid-js/mermaid-cli
```
