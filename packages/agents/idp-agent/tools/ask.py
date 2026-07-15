"""ask_user tool - renders an inline question card in the chat so the user
answers a structured single/multi/free-text prompt in place. The answer is
sent back as the user's next message, so the agent picks up the choice on the
following turn."""

import json
from typing import Any

from strands import tool


@tool
def ask_user(questions: list[dict[str, Any]] | None = None) -> str:
    """Ask the user one or more structured questions, rendered as an inline
    question card in the chat.

    Use this when a decision is the user's to make and you must not guess -
    e.g. an ambiguous choice between options, a missing parameter, or a
    confirmation before an expensive/irreversible action. Prefer this over
    guessing and over a wall of prose asking the user to "reply with A or B".

    Args:
      questions: list of question objects. Each:
        {
          "kind": "single" | "multi" | "text",
          "title": str,                # the question, natural language
          "description": str?,         # optional helper line
          "options": [                 # omit for kind="text"
            {"id": str, "label": str, "description": str?}
          ],
          "allow_custom": bool?,       # show a free-text "other" row
        }
        For a yes/no question use kind="single" with two options.

    Returns: a JSON envelope the chat renders as a question card. The user's
    selection is posted back as their next message, so read it on the next turn
    and act on it.
    """
    if not isinstance(questions, list) or not questions:
        return json.dumps(
            {"_ui_action": "error", "error": "questions must be a non-empty list"},
            ensure_ascii=False,
        )

    norm: list[dict[str, Any]] = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        kind = q.get("kind") or "single"
        if kind not in ("single", "multi", "text"):
            kind = "single"
        title = str(q.get("title") or "").strip()
        if not title:
            continue
        entry: dict[str, Any] = {"kind": kind, "title": title}
        if q.get("description"):
            entry["description"] = str(q["description"])
        opts = q.get("options")
        if isinstance(opts, list) and kind != "text":
            entry["options"] = [
                {
                    "id": str(o.get("id")),
                    "label": str(o.get("label") or o.get("id")),
                    **(
                        {"description": str(o["description"])}
                        if isinstance(o, dict) and o.get("description")
                        else {}
                    ),
                }
                for o in opts
                if isinstance(o, dict) and o.get("id")
            ]
        if q.get("allow_custom"):
            entry["allowCustom"] = True
        norm.append(entry)

    if not norm:
        return json.dumps(
            {"_ui_action": "error", "error": "no valid questions"},
            ensure_ascii=False,
        )

    return json.dumps(
        {"_ui_action": "ask_user", "questions": norm},
        ensure_ascii=False,
    )
