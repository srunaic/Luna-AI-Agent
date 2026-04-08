import os, django, sys, zipfile, io
from django.core.files.base import ContentFile
sys.path.append(os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "luna_server.settings")
django.setup()
from packages.models import Package, PackageVersion
def create_sample_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("manifest.json", '{"name": "luna-sample", "version": "1.0.0", "entry": "index.js"}' )
        zf.writestr("index.js", "console.log('Luna Sample');")
    buf.seek(0)
    return buf
pkg, created = Package.objects.get_or_create(name="luna-sample", defaults={"description": "Test plugin", "author": "Luna"})
if not PackageVersion.objects.filter(package=pkg, version="1.0.0").exists():
    pv = PackageVersion(package=pkg, version="1.0.0")
    pv.file.save("luna-sample-1.0.0.zip", ContentFile(create_sample_zip().read()))
    pv.save()
print("Seed done")

