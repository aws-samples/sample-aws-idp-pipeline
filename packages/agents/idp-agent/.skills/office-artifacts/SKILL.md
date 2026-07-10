---
name: office-artifacts
description: "Create and edit Office documents (.docx, .pptx, .xlsx) as project artifacts using the officecli tool. Use when the user wants to create, edit, or modify a Word document, PowerPoint deck, or Excel spreadsheet, or when an S3 URI with a .docx/.pptx/.xlsx extension is provided. This skill owns the S3 <-> local file workflow that officecli requires; consult the officecli skill (or `load_skill`) for command syntax. Do NOT use for Markdown (.md), PDFs, charts, or diagrams."
---

# Office document artifacts (officecli)

The `officecli` tool operates on **local files only** — it cannot read or write
S3. This skill defines the required workflow for wrapping officecli with the
project's S3 artifact storage. The `officecli` skill documents the CLI command
syntax; this skill documents how to move files in and out of S3 around it.

## Execution Rules

- **Use the `officecli` tool for all document manipulation** — creating, reading,
  inspecting, editing, validating. Do NOT use `code_interpreter` for .docx/.pptx/.xlsx.
- **Local files are ephemeral scratch space.** The runtime's local storage is
  volatile and reused across sessions. **S3 is the source of truth.** Complete
  the workspace → edit → upload flow within a single turn; never assume a local
  file survives to a later turn — if it is gone, download it from S3 again.
- **Every document task MUST start with `artifact_workspace()`** to get an
  isolated working directory. This prevents path collisions between concurrent
  requests. Create and edit all files inside that directory.

## Workflow

### 1. Get a workspace (always first)

```
artifact_workspace()  ->  { "workspace_dir": "/tmp/officecli/<session>/<id>" }
```

Use the returned `workspace_dir` as the parent directory for every file in this task.

### 2a. Create a new document

Run officecli `create` inside the workspace directory:

```
officecli create /tmp/officecli/<session>/<id>/report.docx
```

### 2b. OR edit an existing artifact

Stage it locally first with `artifact_download`. Pass the `artifact_id` and
`filename` from the artifact reference `[artifact:art_xxx](report.docx)`, plus
the workspace directory:

```
artifact_download(artifact_id="art_xxx", filename="report.docx", workspace_dir="/tmp/officecli/<session>/<id>")
  ->  { "local_path": "/tmp/officecli/<session>/<id>/report.docx" }
```

### 3. Edit with officecli

Use the `officecli` tool against the local path. **Before creating/editing, run
`load_skill <pptx|word|excel>`** (via the officecli tool) to load the format
build guide, and use `help <format> <element>` to check schema instead of
guessing. See the `officecli` skill for full command reference.

**Keep each command's output small — work incrementally.** Do NOT emit one huge
`batch` covering the whole document; a single oversized response can hit the
model's output token limit, get truncated, and force a costly retry loop. Build
in small units — roughly one slide / section / sheet-region per `batch` call
(or a handful of related elements) — and issue several calls in sequence. This
keeps each turn fast and failures isolated to one unit.

### 4. Delivery gate (before reporting done)

Any failure = fix and re-check; do NOT deliver until all pass:

1. **Schema**: `validate <file>` → clean, no errors.
2. **Content**: `view <file> issues` → no overflow/format/structure issues; scan
   `view <file> text` for leftover placeholders (xxxx, lorem/ipsum, <TODO>, {{...}}).
3. **Visual audit** (slide decks most of all): `view <file> screenshot --page N`
   returns a rendered image — judge it adversarially for overlap, overflow,
   off-slide shapes, low contrast; fix and re-screenshot until right.
4. **Flush**: end officecli edits with `save <file>` so the file is written to
   disk before upload.

### 5. Upload and report

```
artifact_upload(local_path="/tmp/officecli/<session>/<id>/report.docx")
  ->  { "s3_uri": "...", "artifact_ref": "[artifact:art_xxx](report.docx)" }
```

Report the `artifact_ref` to the user.

## Reading / analyzing an existing document

To read or inspect without editing: `artifact_workspace()` →
`artifact_download(...)` → `officecli` `view <file> text|outline|stats` (or
`--json` on `get`/`query`). No upload needed.
