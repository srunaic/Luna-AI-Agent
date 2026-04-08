from django.urls import path

from .ui import memory_admin_ui
from .views import (
    MemoryAdminDeleteView,
    MemoryAdminGetView,
    MemoryAdminInfoView,
    MemoryAdminListView,
    MemorySearchView,
    MemoryUpsertView,
)

urlpatterns = [
    path("admin/ui/", memory_admin_ui, name="memory-admin-ui"),
    path("upsert/", MemoryUpsertView.as_view(), name="memory-upsert"),
    path("search/", MemorySearchView.as_view(), name="memory-search"),
    path("admin/info/", MemoryAdminInfoView.as_view(), name="memory-admin-info"),
    path("admin/list/", MemoryAdminListView.as_view(), name="memory-admin-list"),
    path("admin/get/", MemoryAdminGetView.as_view(), name="memory-admin-get"),
    path("admin/delete/", MemoryAdminDeleteView.as_view(), name="memory-admin-delete"),
]
