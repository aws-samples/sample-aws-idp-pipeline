"""Generate a Text2SQL reference document for a Parquet dataset.

Ports the notebook's parquet_agent approach: profile the table with DuckDB
(schema + SUMMARIZE + sample rows) and let Bedrock write a Markdown reference
(table overview, column dictionary, query patterns, caveats). This document is
what describe_dataset returns and is the source of truth for run_sql.
"""

import os
import re

import duckdb
from strands import Agent
from strands.models import BedrockModel

REFERENCE_MODEL_ID = os.environ.get(
    "DATASET_REFERENCE_MODEL_ID", "global.anthropic.claude-sonnet-5"
)
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

SYSTEM_PROMPT = """You are a Parquet schema analyst. Produce (1) a short standalone
description and (2) a reference document that a text2SQL agent uses to translate
natural-language questions into correct DuckDB SQL.

The dataset is exposed as the table `data`. You are GIVEN the schema, full-column
statistics (SUMMARIZE), and sample rows below — do NOT ask for more; write the output.

Respond in EXACTLY this format:

<description>
A self-contained description (3-6 sentences) of what this dataset contains: the
subject/domain, what each row represents, the key columns and what they mean, the
row count / scale, and any notable characteristics (hierarchy, categories, time
range, etc.). This is shown in a dataset picker so an agent can decide, WITHOUT
opening the full document, whether this dataset answers a question. Write it in the
same language as the data's textual values when they are non-English.
</description>

Then a structured Markdown reference document with these sections:

### 1. Table Overview
What this dataset represents.

### 2. Column Dictionary
| Column | Type | Description | Example Values | Notes |

### 3. Key Relationships & Business Logic
Implicit meaning, derived columns, enum semantics.

### 4. Common Query Patterns
A few natural-language questions and their DuckDB SQL (use `data` as the table name;
double-quote column names that contain spaces or special characters).

### 5. Caveats
NULL handling, non-unique keys, data-quality anomalies, columns needing quoting.

Keep descriptions concise but unambiguous for an LLM consumer.
"""

_DESCRIPTION_RE = re.compile(r"<description>\s*(.*?)\s*</description>", re.DOTALL | re.IGNORECASE)


def build_reference(con: duckdb.DuckDBPyConnection, dataset_name: str) -> tuple[str, str]:
    """Profile the 'data' table and generate (reference_markdown, description).

    A single Bedrock call returns both a standalone description (for the dataset
    list) and the full reference document (for describe_dataset).
    """
    schema = con.execute("DESCRIBE data").fetchall()
    summarize = con.execute("SUMMARIZE data").fetchall()
    summarize_cols = [d[0] for d in con.execute("SUMMARIZE data").description]
    sample = con.execute("SELECT * FROM data LIMIT 5").fetchall()
    sample_cols = [d[0] for d in con.execute("SELECT * FROM data LIMIT 5").description]
    row_count = con.execute("SELECT COUNT(*) FROM data").fetchone()[0]

    profile = _format_profile(
        dataset_name, row_count, schema, summarize_cols, summarize, sample_cols, sample
    )

    model = BedrockModel(model_id=REFERENCE_MODEL_ID, region_name=AWS_REGION)
    agent = Agent(model=model, system_prompt=SYSTEM_PROMPT)
    output = str(agent(profile))

    # Split the <description> block from the reference document.
    match = _DESCRIPTION_RE.search(output)
    if match:
        description = match.group(1).strip()
        reference = _DESCRIPTION_RE.sub("", output, count=1).strip()
    else:
        description = ""
        reference = output.strip()
    return reference, description


def _format_profile(name, row_count, schema, sum_cols, summarize, sample_cols, sample) -> str:
    lines = [
        f"Dataset name: {name}",
        "Table name to use in SQL: data",
        f"Row count: {row_count}",
        "",
        "## Schema (column, type)",
    ]
    for col in schema:
        lines.append(f"- {col[0]}: {col[1]}")

    lines.append("")
    lines.append("## SUMMARIZE (per-column statistics)")
    lines.append(" | ".join(sum_cols))
    for row in summarize:
        lines.append(" | ".join("" if v is None else str(v) for v in row))

    lines.append("")
    lines.append("## Sample rows")
    lines.append(" | ".join(sample_cols))
    for row in sample:
        lines.append(" | ".join("" if v is None else str(v) for v in row))

    return "\n".join(lines)
