from rest_framework import generics
from .models import Package, PackageVersion
from .serializers import PackageSerializer
from django.http import FileResponse, Http404
class PackageListView(generics.ListAPIView):
    serializer_class = PackageSerializer
    queryset = Package.objects.filter(is_public=True)
    def get_queryset(self):
        qs = super().get_queryset()
        q = self.request.query_params.get("q")
        return qs.filter(name__icontains=q) if q else qs
class PackageDetailView(generics.RetrieveAPIView):
    serializer_class = PackageSerializer
    lookup_field = "name"
    queryset = Package.objects.all()
def download_package(request, name, version):
    try:
        pv = PackageVersion.objects.get(package__name=name, version=version)
        return FileResponse(pv.file.open(), as_attachment=True)
    except:
        raise Http404("Not found")

