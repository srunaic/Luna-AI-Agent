from django.db import models
class Package(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField()
    author = models.CharField(max_length=100)
    is_public = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
class PackageVersion(models.Model):
    package = models.ForeignKey(Package, on_delete=models.CASCADE, related_name="versions")
    version = models.CharField(max_length=20)
    changelog = models.TextField(blank=True)
    file = models.FileField(upload_to="packages/")
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        unique_together = ("package", "version")

