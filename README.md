# 🌙 Luna AI Agent v7.0 — Self-Evolving Autonomous AI

> **루나(Luna)**는 Ollama 로컬 LLM 기반의 **자율 진화형 AI 에이전트**입니다.  
> 사용자 명령 없이도 스스로 학습하고, 자기 코드를 수리하며, 컴퓨터를 제어합니다.  
> 3D VRM 아바타를 통해 실시간으로 대화하고 감정을 표현합니다.

![Luna Screenshot](browser_shot.png)

---

## ✨ 핵심 기능

### 🧠 AI 하네스 아키텍처 (Harness Engineering)

Luna는 **AI 하네스(Harness)** 구조로 설계되었습니다.  
AI 모델의 텍스트 출력을 파싱하여 실제 도구를 실행하고, 결과를 다시 AI에게 피드백하는 **자율 실행 루프**입니다.

```
┌─────────────────────────────────────────┐
│          Luna Harness Architecture       │
│                                         │
│  [AI Model] ──→ "search_web(AI 트렌드)" │
│       ↑              ↓                  │
│   [결과 피드백]   [하네스가 파싱]          │
│       ↑              ↓                  │
│  [요약 & 기억]  ←─ [도구 실행]           │
│                                         │
│  OBSERVE → PLAN → EXECUTE → LEARN       │
│              (반복)                      │
└─────────────────────────────────────────┘
```

### 🔄 자율 진화 시스템 (Self-Evolution Engine)

| 기능 | 설명 |
|------|------|
| **GoalManager** | 스스로 목표를 세우고, 우선순위대로 실행하며, 완료/실패를 관리 |
| **SelfRepairEngine** | Python `ast.parse()`로 자기 코드를 검사하고, 구문 오류를 AI로 자동 수리 |
| **SystemMaintainer** | 서비스 상태 감시, 디스크 관리, 프로세스 자동 재시작 |
| **EvolutionLevel** | 완료한 목표 수에 따라 진화 레벨이 상승 (Lv.1 → Lv.2 → ...) |

### 🛡️ 안전 장치 (Safety Layer)

- **자동 백업**: 모든 파일 수정 전 `.luna_backup/`에 타임스탬프 기반 버전 저장
- **킬 스위치**: `luna_kill_switch.flag` 파일 생성 또는 UI 버튼으로 즉시 정지
- **위험 차단**: Windows 시스템 경로, 위험 명령어 자동 필터링
- **리소스 가드**: CPU/메모리 과부하 시 자율 활동 일시 중단
- **변경 로그**: 모든 수정 이력을 `luna_changes.log`에 기록

### 🎭 3D VRM 아바타 & VTubing

- **Three.js + @pixiv/three-vrm**: 브라우저에서 실시간 3D 캐릭터 렌더링
- **자율 표정/포즈**: AI 답변의 감정에 따라 자동으로 표정과 포즈 변경
- **립싱크**: Edge-TTS 음성과 연동하여 실시간 입 모양 동기화
- **VMC Protocol**: VSeeFace 연동 지원

### 💬 듀얼 브레인 대화 시스템

루나는 **같은 AI 모델을 2가지 모드**로 사용합니다:

| 모드 | 프롬프트 | 역할 |
|------|---------|------|
| **감성 브레인** | 다정한 여자친구 페르소나 | 사용자와 대화, 감정 표현 |
| **논리 브레인** | 자율 코딩 에이전트 프롬프트 | 학습, 수리, 시스템 관리 |

두 모드는 **ChromaDB 기억 저장소를 공유**하여, 자율 학습한 내용을 대화에서 활용합니다.

---

## 🏗️ 아키텍처

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  index.html  │────▶│  Django API  │────▶│   ChromaDB   │
│  (3D VRM +   │     │  (Backend)   │     │  (장기 기억)  │
│   Chat UI)   │     │  :6780       │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│   Ollama     │     │ Agent Watcher│
│  luna model  │     │ (실행 엔진)   │
│  :11434      │     │              │
└──────────────┘     └──────────────┘
                           │
                           ▼
                    ┌──────────────┐     ┌──────────────┐
                    │  Autonomous  │────▶│ Dashboard API│
                    │  Evolution   │     │    :6785     │
                    │  Engine      │     │              │
                    └──────────────┘     └──────────────┘
                           │
                    ┌──────┴──────┐
                    ▼             ▼
             ┌───────────┐ ┌───────────┐
             │GoalManager│ │SelfRepair │
             │           │ │Engine     │
             └───────────┘ └───────────┘
```

---

## 📁 프로젝트 구조

```
LunaProject/
├── index.html               # 메인 UI (3D VRM + 채팅 + 진화 대시보드)
├── luna_chat.html            # 경량 채팅 전용 UI
├── luna_autonomous.py        # 🧠 자율 진화 엔진 (GoalManager + SelfRepair)
├── luna_agent_watcher.py     # 🤖 명령 실행 엔진 (하네스 코어)
├── luna_safety.py            # 🛡️ 안전 장치 (백업, 킬 스위치, 필터)
├── luna_body_controller.py   # 🎭 VRM 신체 제어 (VMC Protocol)
├── luna_tts_server.py        # 🔊 음성 합성 서버 (Edge-TTS)
├── run_luna_all.py           # 🚀 통합 런처
├── start_luna_all.bat        # Windows 원클릭 실행
├── Luna-Modelfile            # Ollama 모델 정의 (페르소나 설정)
├── repair_luna.py            # 긴급 복구 스크립트
│
├── luna-server/              # Django 백엔드
│   ├── actions/              #   명령 큐 관리 API
│   ├── memory/               #   ChromaDB 기억 저장소 API
│   └── manage.py
│
└── vrm/                      # VRM 3D 모델 파일
    └── Luna2.vrm
```

---

## 🚀 Quick Start

### 사전 요구사항
- **Python 3.10+**
- **Ollama** (https://ollama.com — 로컬 LLM 실행)
- **pip 패키지**: `httpx`, `psutil`, `django`, `djangorestframework`, `chromadb`, `flask`, `python-osc`

### 설치 & 실행

```bash
# 1. 저장소 클론
git clone https://github.com/srunaic/Luna-AI-Agent.git
cd Luna-AI-Agent

# 2. Luna 모델 생성
ollama create luna -f Luna-Modelfile

# 3. 전체 시스템 실행 (서버 + TTS + 자율 엔진 + UI 동시 가동)
python run_luna_all.py
```

실행 후 자동으로 `http://localhost:8000/index.html`이 열립니다.

### 비상 정지

```bash
# 방법 1: UI에서 📊 진화 버튼 → 🛑 비상 정지
# 방법 2: 파일 생성
echo "" > luna_kill_switch.flag
# 방법 3: 터미널에서 Ctrl+C
```

---

## 📊 진화 대시보드

우측 패널의 **📊 진화** 버튼을 클릭하면 실시간 대시보드가 열립니다:

- **진화 레벨**: 완료한 목표 수에 따라 자동 상승
- **목표 현황**: 대기/완료/실패 목표 수
- **최근 목표**: 학습/수리/유지보수 활동 로그
- **킬 스위치**: 비상 시 자율 활동 즉시 중단

---

## 🔧 사용 가능한 도구 (Tools)

Luna 하네스에 내장된 도구 목록:

| 도구 | 설명 | 자동 실행 |
|------|------|----------|
| `search_web` | DuckDuckGo 웹 검색 | ✅ |
| `list_files` | 디렉토리 탐색 | ✅ |
| `read_file` | 파일 읽기 | ✅ |
| `search_code` | 코드베이스 검색 | ✅ |
| `check_environment` | 시스템 상태 확인 | ✅ |
| `search_memory` | 기억 검색 | ✅ |
| `remember` | 장기 기억 저장 | ✅ |
| `write_file` | 파일 생성/수정 (백업 자동) | ⚠️ 승인 |
| `replace_code` | 코드 조각 교체 (백업 자동) | ⚠️ 승인 |
| `run_command` | 터미널 명령 실행 | ⚠️ 승인 |
| `self_diagnostic` | 전체 시스템 자기 진단 | ✅ |
| `manage_process` | 프로세스 시작/중지/재시작 | ⚠️ 승인 |
| `rollback` | 파일을 최근 백업으로 복원 | ✅ |
| `install_package` | pip 패키지 설치 | ⚠️ 승인 |

---

## 🧬 버전 히스토리

| 버전 | 주요 변경 |
|------|----------|
| v1.0 | 기본 챗봇 + Ollama 연동 |
| v2.0 | 에이전틱 사고 모델 (Thought → Plan → Execute) |
| v3.0 | 멀티엔진 웹 검색 + 자율 모드 |
| v4.0 | VRM 3D 아바타 + VMC Protocol |
| v5.0 | Edge-TTS 음성 + 립싱크 |
| v6.0 | 통합 런처 + 안정화 |
| **v7.0** | **자율 진화 엔진 + AI 하네스 + 자기 수리 + 안전 장치 + 진화 대시보드** |

---

## 📜 License

MIT License

---

*Built with ❤️ — Luna가 스스로 진화하는 날까지.* 🌙
