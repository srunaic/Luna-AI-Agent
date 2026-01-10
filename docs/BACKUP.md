## 로컬 1중 백업 운영(현재 적용)

목표: Supabase 장애/실수 삭제가 있어도, **최소 1개의 로컬 백업 ZIP**으로 복구 가능하게 운영합니다.

### 백업 위치(로컬)
- **기본 폴더**: `D:\Backup`
- **결과물(예시)**: `D:\Backup\nanodoroshi_backup_YYYY-MM-DD_HH-mm-ss.zip`

### 운영 방식(USB로 옮기기)
- 로컬에서 백업 ZIP 생성
- 생성된 ZIP을 **관리자 USB/외장하드로 수동 복사**
- 권장: USB에는 최소 2~3개 최신본만 유지(가장 최신 + 바로 전 + 1주 전)

---

## 실행 방법

### 1) 준비물
- `pg_dump` (PostgreSQL client tools에 포함)

### 2) 실행
PowerShell에서:
- `SUPABASE_DB_URL` 환경변수 설정(포스트그레스 접속 문자열)
- 스크립트 실행:
  - `scripts/backup/run_backup_local_zip.ps1`

> 참고: 스크립트는 `pg_dump`가 없으면 설치 방법을 안내하고 종료합니다.

---

## (나중에) 2~3중 백업으로 확장(옵션)

원하면 추후 아래를 추가로 구성할 수 있습니다.
- **Supabase 자체 백업(PITR/자동백업)**: 플랜/옵션에 따라 제공
- **Cloudflare R2 백업**: DB 덤프/스토리지 업로드 자동화


