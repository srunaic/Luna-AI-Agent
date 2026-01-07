$ErrorActionPreference = "Stop"

$content = @'
# Luna AI Agent

로컬 LLM/에이전트 기반으로 **코드 편집 + 실행 + 기억(메모리) + 자동화**를 한 번에 묶는 Windows 데스크톱 앱입니다.

- 최근 릴리즈 태그: `v0.1.39`
- 구성: Electron(앱) + Django(로컬 서버) + ChromaDB(로컬 메모리)

## 지금 버전까지 들어간 것들(요약)

### 1) 에디터/워크스페이스
- Monaco 기반 편집기(파일 탐색/탭/터미널/UI 구성)
- 채팅/에이전트 응답을 UI로 스트리밍하고, 작업 진행 상황을 로그로 남김

### 2) 로컬 서버(Django) 자동 구동
- 앱 실행 시 `127.0.0.1:8000`에서 Django 서버가 자동으로 올라오도록 구성
- 서버 준비 완료(ready) 상태를 렌더러로 브로드캐스트해서 UI에서 상태 확인 가능

### 3) 로컬 메모리(ChromaDB) + RAG
- 대화 입력/에이전트 최종 응답/딥러닝 펄스 결과를 **ChromaDB에 저장(upsert)**
- 새 요청이 들어오면 관련 기억을 **검색(search)**해서 프롬프트에 주입(**RAG**)해 컨텍스트를 보강
- 참고: 이건 모델을 파인튜닝하는 방식이 아니라, **검색 기반으로 지능을 보강**하는 구조입니다(저장 + 검색).

### 4) 메모리 관리자 UI
- 브라우저에서 현재 저장된 데이터를 조회/삭제할 수 있는 간단한 관리자 UI 제공
- 접속 URL: `http://127.0.0.1:8000/api/memory/admin/ui/`
- 기본 보안 정책:
  - 토큰(`LUNA_ADMIN_TOKEN`)이 설정되어 있으면 `X-Luna-Admin-Token` 헤더 필요
  - 토큰이 비어 있으면 로컬호스트에서만 접근 허용

### 5) 딥러닝(Deep Learning) 펄스
- 일정 주기로 ‘학습 펄스’를 돌리고, 결과를 메모리에 저장
- 최근에는 펄스 실행 시 메인 프로세스가 죽던 ReferenceError를 수정(v0.1.39)

## 사용 방법

### 설치/실행
- GitHub Releases에서 최신 `Setup.exe`를 받아 설치 후 실행
  - `https://github.com/srunaic/Luna-AI-Agent/releases`

### 메모리 관리자 UI 열기
- 브라우저에서:
  - `http://127.0.0.1:8000/api/memory/admin/ui/`

서버가 아직 안 떠 있으면, 앱을 먼저 실행하거나 아래 방식으로 서버를 직접 실행하면 됩니다.

## 서버 실행 방식(자동/수동)

### 1) 자동(기본)
- 앱 실행 시 Django 서버가 같이 실행됩니다.

### 2) 수동 실행
`luna-server` 폴더에서:

```bat
python manage.py runserver 127.0.0.1:8000 --noreload
```

### 3) 윈도우 로그인 시 서버 자동 실행(선택)
서버만 따로 상시 구동이 필요하면 작업 스케줄러를 사용할 수 있습니다.

- 생성:

```bat
schtasks /Create /F /SC ONLOGON /RL HIGHEST /TN "LunaAI-DjangoServer" /TR "cmd.exe /c C:\path\to\luna-server\start_server.cmd"
```

- 실행/종료/삭제:

```bat
schtasks /Run /TN "LunaAI-DjangoServer"
schtasks /End /TN "LunaAI-DjangoServer"
schtasks /Delete /TN "LunaAI-DjangoServer" /F
```

## 메모리(ChromaDB) 설정 메모

Django 설정에서 기본값은 로컬 영구 저장 모드입니다.

- 기본 경로: `luna-server/chroma_db`
- 기본 컬렉션: `luna_memory`

관련 환경변수:
- `LUNA_CHROMA_MODE`: `local`(기본) / `http`
- `LUNA_CHROMA_PATH`: 로컬 저장 경로
- `LUNA_CHROMA_COLLECTION`: 컬렉션 이름
- `LUNA_CHROMA_HTTP_URL`: 원격 Chroma HTTP 주소(선택)
- `LUNA_CHROMA_AUTH_TOKEN`: 원격 Chroma 인증 토큰(선택)

## 개발 과정에서 진짜 까다로웠던 이슈들(정리)

이번 작업은 기능 자체보다 ‘로컬 앱에서 백엔드/DB/빌드/배포까지 한 번에 굴리는 체계’를 안정화하는 게 더 어려웠습니다.

- PowerShell에서 bash식 heredoc이 깨지는 문제
  - 멀티라인 파일 생성은 here-string + `Set-Content -Encoding utf8`로 정리
- 배포 이후 서버 코드 일부가 0바이트가 되어 Django가 404/500을 뿜던 문제
  - 빌드 포함/제외 규칙, 실제 산출물 포함 경로를 다시 점검하고 파일 복구
- Electron 메인 프로세스에서 인코딩이 깨지면 즉시 SyntaxError로 하얀 화면/크래시가 나는 문제
  - 문자열/파일을 UTF-8로 유지하고, 깨지기 쉬운 구간을 최대한 안전하게 정리
- IPC 핸들러가 조건문 내부에 있어서 ‘가끔’ 등록이 안 되던 문제
  - 핸들러 등록은 항상 실행되는 위치로 이동
- GitHub Actions에서 작업 디렉토리/의존성(tsconfig 포함) 때문에 빌드가 깨지던 문제
  - `webview-ui` 별도 `npm ci` 단계 추가, 루트 TS 컴파일 범위 조정
- 딥러닝 펄스에서 스코프 밖 변수(예: `augmentedInstruction`)를 참조해 메인이 죽던 문제
  - 스코프 내 변수만 사용하도록 수정하고 릴리즈 태그로 반영

## 트러블슈팅

- 관리자 UI가 403
  - 로컬호스트가 아닌 곳에서 접근했거나, `LUNA_ADMIN_TOKEN`을 켰는데 헤더가 없는 경우입니다.
- 8000 포트가 이미 사용 중
  - 기존 Django가 떠 있거나 다른 프로세스가 포트를 점유한 상태입니다.
- 하얀 화면/즉시 종료
  - 메인 프로세스 JS 인코딩/문법 오류, 또는 GPU 가속 이슈가 원인인 경우가 많습니다.

---

이 프로젝트는 ‘설치하면 로컬에서 계속 굴러가는 에이전트 개발환경’을 목표로, 기능보다 안정성부터 차근차근 정리해 나가는 중입니다.
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText("README.md", $content, $utf8NoBom)
Write-Host "Updated README.md (UTF-8 no BOM)"
















