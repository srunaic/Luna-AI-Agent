from rest_framework import serializers
from .models import Package, PackageVersion
class PackageVersionSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()
    class Meta:
        model = PackageVersion
        fields = ["version", "changelog", "download_url"]
    def get_download_url(self, obj):
        request = self.context.get("request")
        return request.build_absolute_uri(obj.file.url) if obj.file else None
class PackageSerializer(serializers.ModelSerializer):
    latest_version = serializers.SerializerMethodField()
    versions = PackageVersionSerializer(many=True, read_only=True)
    class Meta:
        model = Package
        fields = ["id", "name", "description", "author", "latest_version", "versions"]
    def get_latest_version(self, obj):
        latest = obj.versions.order_by("-created_at").first()
        return latest.version if latest else None

