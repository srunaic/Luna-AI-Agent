from functools import lru_cache
from typing import Any, Dict
from urllib.parse import urlparse

from django.conf import settings


def _get_chroma_settings() -> Dict[str, Any]:
    return {
        "mode": getattr(settings, "LUNA_CHROMA_MODE", "local"),
        "path": getattr(settings, "LUNA_CHROMA_PATH", "chroma_db"),
        "collection": getattr(settings, "LUNA_CHROMA_COLLECTION", "luna_memory"),
        "http_url": getattr(settings, "LUNA_CHROMA_HTTP_URL", ""),
        "auth_token": getattr(settings, "LUNA_CHROMA_AUTH_TOKEN", ""),
    }


@lru_cache(maxsize=1)
def get_collection():
    """Returns a Chroma collection (local persistent or remote HTTP). Cached for process lifetime."""

    cfg = _get_chroma_settings()
    mode = (cfg.get("mode") or "local").lower()

    try:
        import chromadb  # type: ignore
    except Exception as e:  # pragma: no cover
        raise RuntimeError(
            "ChromaDB is not installed. Install server deps: pip install -r luna-server/requirements.txt"
        ) from e

    if mode == "http":
        if not cfg.get("http_url"):
            raise RuntimeError("LUNA_CHROMA_MODE=http requires LUNA_CHROMA_HTTP_URL")
        u = urlparse(cfg["http_url"])
        if not u.hostname:
            raise RuntimeError("Invalid LUNA_CHROMA_HTTP_URL (missing host)")
        ssl = (u.scheme or "").lower() == "https"
        port = u.port or (443 if ssl else 80)
        headers = {}
        token = (cfg.get("auth_token") or "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        client = chromadb.HttpClient(host=u.hostname, port=port, ssl=ssl, headers=headers)
    else:
        client = chromadb.PersistentClient(path=cfg["path"])

    return client.get_or_create_collection(name=cfg["collection"])
