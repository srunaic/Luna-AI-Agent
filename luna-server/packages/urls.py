from django.urls import path
from .views import PackageListView, PackageDetailView, download_package
urlpatterns = [
    path("packages/", PackageListView.as_view(), name="package-list"),
    path("packages/<str:name>/", PackageDetailView.as_view(), name="package-detail"),
    path("packages/<str:name>/<str:version>/download/", download_package, name="package-download"),
]

