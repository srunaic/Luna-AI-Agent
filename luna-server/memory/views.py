import uuid

from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .admin_auth import require_admin
from .chroma_client import get_collection
from .embeddings import hashing_embedding
from .serializers import (
    MemoryAdminDeleteSerializer,
    MemoryAdminGetSerializer,
    MemoryAdminListSerializer,
    MemorySearchSerializer,
    MemoryUpsertSerializer,
)


@method_decorator(csrf_exempt, name="dispatch")
class MemoryUpsertView(APIView):
    def post(self, request):
        serializer = MemoryUpsertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        items = serializer.validated_data["items"]
        ids, docs, metas, embeds = [], [], [], []

        for item in items:
            mid = item.get("id") or str(uuid.uuid4())
            text = item["text"]
            meta = item.get("metadata") or {}
            meta.setdefault("type", "memory")

            ids.append(mid)
            docs.append(text)
            metas.append(meta)
            embeds.append(hashing_embedding(text))

        col = get_collection()
        col.upsert(ids=ids, documents=docs, metadatas=metas, embeddings=embeds)
        return Response({"ids": ids}, status=status.HTTP_200_OK)


@method_decorator(csrf_exempt, name="dispatch")
class MemorySearchView(APIView):
    def post(self, request):
        serializer = MemorySearchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        query = serializer.validated_data["query"]
        top_k = serializer.validated_data["top_k"]

        col = get_collection()
        q_emb = hashing_embedding(query)
        res = col.query(query_embeddings=[q_emb], n_results=top_k, include=["documents", "metadatas", "distances"])

        out = []
        ids = (res.get("ids") or [[]])[0]
        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        for i in range(len(ids)):
            out.append(
                {
                    "id": ids[i],
                    "text": docs[i] if i < len(docs) else None,
                    "metadata": metas[i] if i < len(metas) else None,
                    "distance": dists[i] if i < len(dists) else None,
                }
            )

        return Response({"results": out}, status=status.HTTP_200_OK)


@method_decorator(csrf_exempt, name="dispatch")
class MemoryAdminInfoView(APIView):
    def get(self, request):
        require_admin(request)
        col = get_collection()
        return Response({"collection": getattr(col, "name", None), "count": col.count()}, status=status.HTTP_200_OK)


@method_decorator(csrf_exempt, name="dispatch")
class MemoryAdminListView(APIView):
    def get(self, request):
        require_admin(request)
        serializer = MemoryAdminListSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        limit = serializer.validated_data["limit"]
        offset = serializer.validated_data["offset"]

        col = get_collection()
        res = col.get(limit=limit, offset=offset, include=["documents", "metadatas"])
        ids = res.get("ids") or []
        docs = res.get("documents") or []
        metas = res.get("metadatas") or []

        out = []
        for i in range(len(ids)):
            out.append({"id": ids[i], "text": docs[i] if i < len(docs) else None, "metadata": metas[i] if i < len(metas) else None})

        return Response({"total": col.count(), "limit": limit, "offset": offset, "results": out}, status=status.HTTP_200_OK)


@method_decorator(csrf_exempt, name="dispatch")
class MemoryAdminGetView(APIView):
    def get(self, request):
        require_admin(request)
        serializer = MemoryAdminGetSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        mid = serializer.validated_data["id"]

        col = get_collection()
        res = col.get(ids=[mid], include=["documents", "metadatas"])
        ids = res.get("ids") or []
        if not ids:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)

        docs = res.get("documents") or []
        metas = res.get("metadatas") or []
        return Response({"id": ids[0], "text": docs[0] if docs else None, "metadata": metas[0] if metas else None}, status=status.HTTP_200_OK)


@method_decorator(csrf_exempt, name="dispatch")
class MemoryAdminDeleteView(APIView):
    def post(self, request):
        require_admin(request)
        serializer = MemoryAdminDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data["ids"]
        col = get_collection()
        col.delete(ids=ids)
        return Response({"deleted": ids}, status=status.HTTP_200_OK)
