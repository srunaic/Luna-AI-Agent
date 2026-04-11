import os
import time
import asyncio
import re
import httpx
import edge_tts
from django.conf import settings
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

    @action(detail=False, methods=['post'])
    def execute_now(self, request):
        """채팅에서 온 ACTION을 즉시 approved 상태로 생성 (Agent Watcher가 자동 실행)"""
        tool_name = request.data.get('tool_name', '')
        arguments_json = request.data.get('arguments_json', '{}')
        
        if not tool_name:
            return Response({'error': 'tool_name is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        action_obj = Action.objects.create(
            tool_name=tool_name,
            arguments_json=arguments_json,
            status='approved'
        )
        return Response({
            'id': action_obj.id,
            'tool_name': action_obj.tool_name,
            'status': action_obj.status
        })

    @action(detail=True, methods=['get'])
    def result(self, request, pk=None):
        """특정 Action의 실행 결과 조회"""
        try:
            action_obj = Action.objects.get(pk=pk)
            return Response({
                'id': action_obj.id,
                'tool_name': action_obj.tool_name,
                'status': action_obj.status,
                'result': action_obj.result
            })
        except Action.DoesNotExist:
            return Response({'error': 'Action not found'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'])
    def speak(self, request):
        """텍스트를 음성으로 변환 (Edge-TTS 또는 로컬 XTTS)"""
        text = request.data.get('text', '')
        # 프론트엔드 value: 'edge_sunhi' 또는 'xtts_v2'
        model = request.data.get('model', 'edge_sunhi')
        
        if not text:
            return Response({'error': 'No text provided'}, status=status.HTTP_400_BAD_REQUEST)

        # 시스템 태그 제거 (예: [[TOOL_CALL: ...]])
        clean_text = re.sub(r'\[\[.*?\]\]', '', text).strip()
        if not clean_text:
            return Response({'audio_url': None, 'msg': 'No speakable text'})

        timestamp = int(time.time() * 1000)
        # 확장자 설정
        ext = "wav" if model == 'xtts_v2' else "mp3"
        filename = f"luna_speech_{timestamp}.{ext}"
        filepath = os.path.join(settings.MEDIA_ROOT, filename)
        
        os.makedirs(settings.MEDIA_ROOT, exist_ok=True)

        try:
            if model == 'xtts_v2': # 로컬 XTTS 서버 (6781 포트)
                with httpx.Client() as client:
                    res = client.post(
                        "http://127.0.0.1:6781/synthesize", 
                        json={"text": clean_text}, 
                        timeout=120
                    )
                    if res.status_code == 200:
                        with open(filepath, 'wb') as f:
                            f.write(res.content)
                    else:
                        return Response({'error': f'XTTS 서버 오류: {res.text}'}, status=500)
            else: # Microsoft Edge TTS ('edge_sunhi' 또는 폴백)
                voice = "ko-KR-SunHiNeural"
                communicate = edge_tts.Communicate(clean_text, voice)
                asyncio.run(communicate.save(filepath))

            audio_url = f"{settings.MEDIA_URL}{filename}"
            return Response({'audio_url': audio_url})
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'error': str(e)}, status=500)
