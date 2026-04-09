from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
from .models import Action
from rest_framework import serializers

class ActionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Action
        fields = '__all__'

class ActionViewSet(viewsets.ModelViewSet):
    queryset = Action.objects.all()
    serializer_class = ActionSerializer

    @action(detail=False, methods=['get'])
    def pending(self, request):
        actions = Action.objects.filter(status='pending').order_by('created_at')
        serializer = self.get_serializer(actions, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def approved(self, request):
        actions = Action.objects.filter(status='approved').order_by('created_at')
        serializer = self.get_serializer(actions, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['patch'])
    def approve(self, request, pk=None):
        action_obj = self.get_object()
        action_obj.status = 'approved'
        action_obj.save()
        return Response({'status': 'approved'})

    @action(detail=False, methods=['get'])
    def pick_folder(self, request):
        import tkinter as tk
        from tkinter import filedialog
        try:
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True) # Bring to front
            folder_path = filedialog.askdirectory(parent=root, title="Select Luna Workspace")
            root.destroy()
            return Response({'path': folder_path})
        except Exception as e:
            return Response({'error': str(e)}, status=500)
