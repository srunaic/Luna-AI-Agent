from django.conf import settings
from rest_framework.exceptions import PermissionDenied


def _is_localhost(remote_addr: str) -> bool:
    return remote_addr in ("127.0.0.1", "::1")


def require_client(request) -> None:
    """
    Client guard for memory upsert/search.

    - If LUNA_CLIENT_TOKEN is set: require X-Luna-Client-Token header to match.
    - Else: allow only if LUNA_CLIENT_ALLOW_LOCALHOST and request is from localhost.
    """
    token = (getattr(settings, "LUNA_CLIENT_TOKEN", "") or "").strip()
    remote_addr = (request.META.get("REMOTE_ADDR") or "").strip()

    if token:
        got = (request.headers.get("X-Luna-Client-Token") or "").strip()
        if got != token:
            raise PermissionDenied("Invalid client token.")
        return

    allow_localhost = bool(getattr(settings, "LUNA_CLIENT_ALLOW_LOCALHOST", False))
    if allow_localhost and _is_localhost(remote_addr):
        return

    raise PermissionDenied(
        "Client access is restricted. Set LUNA_CLIENT_TOKEN or enable LUNA_CLIENT_ALLOW_LOCALHOST for localhost."
    )
