from rest_framework import serializers


class MemoryItemSerializer(serializers.Serializer):
    id = serializers.CharField(required=False, allow_blank=False)
    text = serializers.CharField(required=True, allow_blank=False)
    metadata = serializers.DictField(required=False)


class MemoryUpsertSerializer(serializers.Serializer):
    items = MemoryItemSerializer(many=True)


class MemorySearchSerializer(serializers.Serializer):
    query = serializers.CharField(required=True, allow_blank=False)
    top_k = serializers.IntegerField(required=False, min_value=1, max_value=50, default=10)


class MemoryAdminListSerializer(serializers.Serializer):
    limit = serializers.IntegerField(required=False, min_value=1, max_value=200, default=50)
    offset = serializers.IntegerField(required=False, min_value=0, default=0)


class MemoryAdminGetSerializer(serializers.Serializer):
    id = serializers.CharField(required=True, allow_blank=False)


class MemoryAdminDeleteSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.CharField(), min_length=1, max_length=200)
