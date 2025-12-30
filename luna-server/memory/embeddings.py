import hashlib
import math
import re
from typing import List


_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+", re.UNICODE)


def _tokenize(text: str) -> List[str]:
    return _TOKEN_RE.findall((text or "").lower())


def hashing_embedding(text: str, dim: int = 384) -> List[float]:
    """
    Deterministic, offline embedding to enable ChromaDB similarity search without external models.
    Lightweight signed hashing (bag-of-words).
    """
    if dim <= 0:
        raise ValueError("dim must be > 0")

    vec = [0.0] * dim
    tokens = _tokenize(text)
    if not tokens:
        return vec

    for tok in tokens:
        h = hashlib.sha1(tok.encode("utf-8")).digest()
        idx = int.from_bytes(h[:4], "little", signed=False) % dim
        sign = 1.0 if (h[4] & 1) == 1 else -1.0
        vec[idx] += sign

    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec
