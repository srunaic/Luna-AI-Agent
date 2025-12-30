# Luna AI Agent

 AI 에이전트 개발환경 (Electron + Django + ChromaDB)

- 최신 Demo 릴리즈: v0.1.39
  
## 핵심 기능
- 메모리/RAG: ChromaDB 저장 + 검색
- 관리자 UI: http://127.x.x.x.xxxx/api/memory/admin/ui/ <-- 내 관리자 서버에서만 작동가능
- 로컬 Django 자동 구동: 127.0.0.1:8000

## Demo version
- token limit 50 
- Releases: https://github.com/srunaic/Luna-AI-Agent/releases 참고

## 정식 version 
- token 500
- AI Agent SD 캐릭터 음성인식 개발 중
- pro 버전 개발중


## Demo 버전 실행 시 주의사항

Ollama 기반 LLM 만 현재 제공 하기 때문에 llm Ollama download 필수 실행 시 terminal 에 ollama serve 서버 실행 부탁드립니다.

## 개발 과정 이슈
- 인코딩(UTF-8) 문제
- 배포 산출물 0바이트 문제
- Actions 빌드(webview-ui, tsconfig) 문제
- 딥러닝 펄스 크래시(ReferenceError) 수정 (v0.1.39)
