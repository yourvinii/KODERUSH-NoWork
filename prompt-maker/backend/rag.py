"""Tiny RAG: keyword-overlap retrieval over knowledge/*.md.

shortcut: no embeddings, so matching is by shared words (works best on English terms);
upgrade to Gemini embeddings + a vector index if the knowledge base outgrows ~200 chunks.
"""
import math
import re
from collections import Counter
from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"
MIN_SCORE = 1.0  # below this we return nothing so the AI admits it does not know

_WORD = re.compile(r"[a-z0-9\+\#\.]+")


def _tokens(text: str) -> list[str]:
    return [w.strip(".") for w in _WORD.findall(text.lower()) if len(w.strip(".")) > 1]


def load_chunks(directory: Path = KNOWLEDGE_DIR) -> list[dict]:
    """One chunk per '## ' section; the file's '# ' title is kept as the source."""
    chunks = []
    for path in sorted(directory.glob("*.md")):
        title = path.stem
        for section in re.split(r"^## ", path.read_text(encoding="utf-8"), flags=re.M):
            section = section.strip()
            if not section:
                continue
            if section.startswith("# "):
                title = section.splitlines()[0][2:].strip()
                continue
            chunks.append({"source": title, "text": section})
    return chunks


class Index:
    def __init__(self, chunks: list[dict]):
        self.chunks = chunks
        self.counts = [Counter(_tokens(c["source"] + " " + c["text"])) for c in chunks]
        df = Counter(w for c in self.counts for w in c)
        self.idf = {w: math.log(1 + len(chunks) / n) for w, n in df.items()}

    def search(self, query: str, k: int = 4) -> list[dict]:
        q = set(_tokens(query))
        scored = []
        for chunk, counts in zip(self.chunks, self.counts):
            score = sum(self.idf.get(w, 0) * (1 + math.log(counts[w])) for w in q if w in counts)
            if score >= MIN_SCORE:
                scored.append((score, chunk))
        scored.sort(key=lambda s: s[0], reverse=True)
        return [c for _, c in scored[:k]]
