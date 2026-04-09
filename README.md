# Luna Soul AI Agent v2.0 (Antigravity Grade) 🌙🚀

안정적이고 자율적인 개발 파트너, **루나(Luna)** 프로젝트의 새로운 시대를 여는 v2.0 릴리즈입니다. 
Antigravity의 에이전틱 프레임워크를 이식받아 단순한 챗봇을 넘어 스스로 생각하고 행동하는 자율형 코딩 에이전트로 진화했습니다.

## 🌟 핵심 기능 (Key Features)

### 1. 자율적 사고 모델 (Agentic Chain-of-Thought)
- **THOUGHT (사고)**: 사용자의 의도를 분석하고 기술 스택 및 프로젝트 구조를 파악합니다.
- **PLAN (계획)**: 작업을 해결하기 위한 단계별 로드맵을 스스로 수립합니다.
- **EXECUTION (실행)**: 수립된 계획에 따라 도구를 호출하여 코드를 작성하고 검증합니다.

### 2. 실시간 사고 시각화 (Thinking Intelligence UI)
- **Streaming UI**: 루나가 대답을 주저하지 않고 실시간으로 자신의 생각을 한 글자씩 보여줍니다.
- **Thinking Panel**: 답변 창 상단에 루나의 내부 추론 과정을 시각화하여 작업의 투명성을 높였습니다.

### 3. 강력한 검색 아키텍처 (Multi-tier Search)
- **Localized Search**: 한국어(`kl=kr-kr`) 검색 최적화 및 URL 전처리 기능을 통해 정확도 높은 정보를 수집합니다.
- **3-Tier Backup**: DuckDuckGo HTML, DuckDuckGo API, Wikipedia를 결합하여 차단 없는 정보 탐색이 가능합니다.

### 4. 저사양 최적화 (Extreme Optimization)
- **Prompt Compression**: 프롬프트를 핵심 위주로 압축하여 로컬 LLM(Ollama)의 추론 속도를 비약적으로 향상시켰습니다.
- **Context Filtering**: 대화 기록을 효율적으로 관리하여 메모리 점유율을 최소화했습니다.

### 5. 자율 학습 및 오류 정정 (Auto-Pilot & Self-Correction)
- **Auto-Pilot Mode**: 사용자의 승인 없이도 스스로 계획을 완수할 때까지 연속적으로 작업을 수행합니다.
- **Self-Reflect**: 작업 실패 시 에러 로그를 분석하고 즉시 다른 대안을 찾아 재시도합니다.

## 🛠 구성 요소 (Components)

- **`luna_chat.html`**: Antigravity 급 UI가 적용된 스트리밍 채팅 인터페이스.
- **`luna_agent_watcher.py`**: 시스템 제어, 검색, 도구 실행을 담당하는 핵심 에이전트 엔진.
- **`luna-server`**: 장기 기억(Memory) 및 작업 큐를 관리하는 백엔드 서버.
- **`Luna-Modelfile`**: 루나의 페르소나와 시스템 설정을 담은 Ollama 모델 정의 파일.

## 🚀 시작하기 (Quick Start)

1. **Ollama 실행**: `ollama run luna` (또는 LLaVA 모듈 활성화)
2. **백엔드 서버 가동**: `python manage.py runserver` (luna-server 폴더)
3. **와처 실행**: `python luna_agent_watcher.py`
4. **인터페이스 접속**: `luna_chat.html`을 브라우저에서 엽니다.

---
*Developed with ❤️ and Antigravity Tech.*
