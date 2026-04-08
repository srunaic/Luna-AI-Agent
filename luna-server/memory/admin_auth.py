from django.conf import settings
from rest_framework.exceptions import PermissionDenied


def _is_localhost(remote_addr: str) -> bool:
    return remote_addr in ("127.0.0.1", "::1")


def require_admin(request) -> None:
    """
    Admin guard for memory DB inspection/edit.

    - If LUNA_ADMIN_TOKEN is set: require X-Luna-Admin-Token header to match.
    - Else: only allow localhost access (REMOTE_ADDR).
    """
    token = (getattr(settings, "LUNA_ADMIN_TOKEN", "") or "").strip()
    remote_addr = (request.META.get("REMOTE_ADDR") or "").strip()

    if token:
        got = (request.headers.get("X-Luna-Admin-Token") or "").strip()
        if got != token:
            raise PermissionDenied("Invalid admin token.")
        return

    allow_localhost = bool(getattr(settings, "LUNA_ADMIN_ALLOW_LOCALHOST", True))
    if allow_localhost and _is_localhost(remote_addr):
        return

    raise PermissionDenied("Admin access is restricted. Set LUNA_ADMIN_TOKEN or access from localhost.")
