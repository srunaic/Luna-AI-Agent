from django.http import HttpRequest, HttpResponse
from django.shortcuts import render

from .admin_auth import require_admin


def memory_admin_ui(request: HttpRequest) -> HttpResponse:
    require_admin(request)
    return render(request, "memory/admin.html", {})
