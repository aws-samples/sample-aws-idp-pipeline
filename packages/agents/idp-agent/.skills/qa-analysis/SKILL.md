---
name: qa-analysis
description: "Add additional QA analysis to document segments. When the user asks for additional analysis, deeper analysis, more questions about a specific document or segment. Triggers: '추가분석', 'additional analysis', 'analyze more', 'add QA', or when asking to examine a document segment more closely."
---

# QA Analysis Skill

## Workflow

1. Identify the target document_id from conversation context
2. Call `get_document_segments` to check segment count
3. If total_segments == 1 → proceed with segment_index=0
4. If total_segments > 1 → ask user which page/segment to analyze
5. Ask user what question they want answered (if not already specified)
6. Call `add_document_qa` with the parameters
7. Present the result to the user
