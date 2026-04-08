# Luna AI Agent (LUNA Soul)

High-performance AI Orchestrator powered by **Google Gemma 4**.

Luna AI Agent는 복잡한 작업을 자율적으로 수행하는 하이엔드 AI 에이전트입니다. 이제 최신 **Gemma 4** 모델이 Luna Soul의 핵심 엔진으로 이식되어 더욱 강력한 성능과 지능을 제공합니다.

## 핵심 변경 사항 (v1.0.0 정식 릴리즈)
- **Gemma 4 이식 완료**: Google의 최신 Gemma 4 모델을 Luna Soul의 기본 엔진으로 통합했습니다.
- **UI/UX 간소화**: 복잡한 설정들을 제거하고 "Luna Soul" 엔진 하나에 집중하여 사용자 편의성을 극대화했습니다.
- **원클릭 실행**: `run_luna_ai_agent.bat`를 통해 별도의 복잡한 설정 없이 원클릭으로 에이전트를 구동할 수 있습니다.
- **관리자 권한 자동 승격**: 시스템 접근 및 캐시 보안 문제를 해결하기 위해 자동으로 관리자 권한을 요청합니다.

## 주요 기능
- **자율 행동 (Action)**: 파일 시스템 탐색, 코드 작성, 터미널 명령 실행, 웹 검색 등을 스스로 판단하여 수행합니다.
- **장기 기억 (Deep Learning)**: ChromaDB를 기반으로 대화와 작업 내용을 학습하고 나중에 다시 활용합니다.
- **로컬 보안**: Ollama를 기반으로 모든 AI 추론이 로컬에서 이루어져 데이터가 외부로 유출되지 않습니다.

## 시작하기

### 1단계: Ollama 설치
이 에이전트는 Ollama를 기반으로 작동합니다. [Ollama 공식 홈페이지](https://ollama.com)에서 프로그램을 설치해 주세요.

### 2단계: 에이전트 실행
프로젝트 루트 폴더에 있는 `run_luna_ai_agent.bat` 파일을 더블 클릭하여 실행하세요.
- 첫 실행 시 `gemma4` 모델(약 9.6GB)을 자동으로 다운로드합니다.
- 관리자 권한 요청 창이 뜨면 **[예]**를 눌러주세요.

## 개발 정보
- **Frontend**: HTML5, Vanilla JS (Electron webview-ui)
- **Backend**: Python Django (luna-server)
- **Database/Memory**: ChromaDB Vector Store
- **LLM Engine**: Ollama (Google Gemma 4)

---
© 2026 Luna AI Agent Project. Dedicated to high-end autonomous coding agents.
