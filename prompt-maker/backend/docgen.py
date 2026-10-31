"""Builds the downloadable Word document from the six prompts."""
import io
import re

from docx import Document
from docx.shared import Pt

MAX_STEPS = 12
MAX_TITLE = 200
MAX_PROMPT = 20000

_LABEL = re.compile(r"^([A-Z][\w /&-]{1,40}):\s*(.*)$")  # "Role: ...", "Goal of this step: ..."
_BULLET = re.compile(r"^\s*[-*•]\s+(.*)$")


def validate(data) -> tuple[str, list[dict]]:
    """Returns (ai_tool, steps) or raises ValueError. The body comes from the browser, so nothing is trusted."""
    if not isinstance(data, dict):
        raise ValueError("body must be an object")
    steps = data.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_STEPS:
        raise ValueError(f"steps must be a list of 1 to {MAX_STEPS} items")
    clean = []
    for s in steps:
        title, prompt = (s.get("title"), s.get("prompt")) if isinstance(s, dict) else (None, None)
        if not (isinstance(title, str) and isinstance(prompt, str) and title.strip() and prompt.strip()):
            raise ValueError("each step needs a non-empty title and prompt")
        if len(title) > MAX_TITLE or len(prompt) > MAX_PROMPT:
            raise ValueError("step too long")
        clean.append({"title": title.strip(), "prompt": prompt.strip()})
    tool = data.get("ai_tool")
    return (tool.strip()[:80] if isinstance(tool, str) else ""), clean


def build_docx(ai_tool: str, steps: list[dict]) -> bytes:
    doc = Document()
    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = Pt(11)
    doc.add_heading("NoWork - Your Build Prompts", 0)
    if ai_tool:
        doc.add_paragraph(f"Written for {ai_tool}. Paste the steps into your AI tool one at a time, in order.")
    for i, step in enumerate(steps):
        if i:
            doc.add_page_break()
        doc.add_heading(step["title"], 1)
        for line in step["prompt"].splitlines():
            if not line.strip():
                continue
            bullet = _BULLET.match(line)
            label = _LABEL.match(line)
            para = doc.add_paragraph(style="List Bullet" if bullet else None)
            if bullet:
                para.add_run(bullet.group(1))
            elif label:
                para.add_run(label.group(1) + ":").bold = True  # keeps numbered lines as typed; only section labels get bold
                para.add_run(" " + label.group(2))
            else:
                para.add_run(line)
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()
