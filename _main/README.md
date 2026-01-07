# Luna AI Agent

Windows에서 돌아가는 **로컬 에이전트 개발환경**입니다. (Electron + Django + ChromaDB)

- **최신 릴리즈**: `v0.1.39`

## 핵심 기능(요약)

- **메모리/RAG**: 대화 입력/에이전트 최종 응답/딥러닝 펄스 결과를 ChromaDB에 저장하고, 새 요청 시 관련 기억을 검색해 프롬프트에 주입합니다.
- **관리자 UI**: 저장된 메모리를 조회/삭제 등으로 확인할 수 있습니다.
- **로컬 Django 자동 구동**: 앱 실행 시 로컬 서버(`127.0.0.1:8000`)가 자동으로 올라옵니다.

## 바로 쓰는 링크

- **관리자 UI**: `http://127.0.0.1:8000/api/memory/admin/ui/`
- **Releases**: `https://github.com/srunaic/Luna-AI-Agent/releases`

## 개발 과정에서 어려웠던 점(요약)

- **인코딩**: Windows/PowerShell/빌드 환경에 따라 UTF-8이 깨지면 Electron 메인 프로세스가 SyntaxError로 즉시 크래시하는 케이스가 있었음
- **0바이트 산출물**: 배포 후 서버 파일 일부가 0바이트가 되면서 Django URLConf/템플릿이 깨져 404/500이 발생했던 문제
- **Actions 빌드**: `webview-ui` 별도 의존성 설치 및 tsconfig 컴파일 범위/워크플로우 트리거 이슈로 빌드가 반복 실패했던 문제
- **딥러닝 펄스 크래시 수정**: 스코프 밖 변수 참조로 메인 프로세스가 죽던 ReferenceError를 `v0.1.39`에서 수정