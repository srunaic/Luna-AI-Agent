"""
Luna Semantic Embedding — Ollama 기반 시맨틱 임베딩
====================================================
기존 해시 기반 임베딩을 Ollama AI 임베딩으로 교체.
기억이 많아질수록 검색 정확도가 향상됩니다.
"""
import hashlib
import math
import re
import json
from typing import List
from urllib.request import Request, urlopen

_TOKEN_RE = re.compile(r"[A-Za-z0-9_\uac00-\ud7af]+", re.UNICODE)

OLLAMA_EMBED_URL = "http://127.0.0.1:11434/api/embed"
EMBED_MODEL = "gemma3:27b"  # 메인 모델로 임베딩 (가장 정확)
EMBED_DIM = 384

# === Fallback: 기존 해시 임베딩 (Ollama 접속 불가 시) ===
def _tokenize(text: str) -> List[str]:
    return _TOKEN_RE.findall((text or "").lower())

def _hashing_embedding(text: str, dim: int = EMBED_DIM) -> List[float]:
    """기존 해시 기반 임베딩 (fallback)"""
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

# === Primary: Ollama 시맨틱 임베딩 ===
def _ollama_embedding(text: str) -> List[float]:
    """Ollama API를 사용한 진짜 시맨틱 임베딩"""
    try:
        payload = json.dumps({
            "model": EMBED_MODEL,
            "input": text[:2000]  # 토큰 제한
        }).encode("utf-8")
        
        req = Request(
            OLLAMA_EMBED_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        
        with urlopen(req, timeout=30) as res:
            data = json.loads(res.read().decode("utf-8"))
            embeddings = data.get("embeddings", [])
            if embeddings and len(embeddings) > 0:
                vec = embeddings[0]
                # ChromaDB 호환을 위해 384차원으로 축소 (필요 시)
                if len(vec) > EMBED_DIM:
                    # 간단한 차원 축소: 청크별 평균
                    chunk_size = len(vec) // EMBED_DIM
                    reduced = []
                    for i in range(EMBED_DIM):
                        start = i * chunk_size
                        end = start + chunk_size
                        chunk = vec[start:end]
                        reduced.append(sum(chunk) / len(chunk) if chunk else 0.0)
                    vec = reduced
                elif len(vec) < EMBED_DIM:
                    vec.extend([0.0] * (EMBED_DIM - len(vec)))
                
                # L2 정규화
                norm = math.sqrt(sum(v * v for v in vec))
                if norm > 0:
                    vec = [v / norm for v in vec]
                return vec
    except Exception as e:
        pass  # Fallback to hashing
    
    return None

# === Public API (기존 코드 호환) ===
def hashing_embedding(text: str, dim: int = EMBED_DIM) -> List[float]:
    """
    시맨틱 임베딩 (Ollama 사용) + 해시 폴백.
    기존 코드와 함수명 호환을 위해 같은 이름 유지.
    """
    # 1차: Ollama 시맨틱 임베딩 시도
    result = _ollama_embedding(text)
    if result:
        return result
    
    # 2차: 해시 기반 폴백
    return _hashing_embedding(text, dim)
