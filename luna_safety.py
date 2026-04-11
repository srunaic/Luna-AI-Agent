"""
Luna Safety Layer v1.0 — 자율 AI의 안전 장치
=============================================
- 자동 백업: 파일 수정 전 .luna_backup/ 에 버전별 저장
- 변경 로그: luna_changes.log 에 모든 수정 기록
- 킬 스위치: luna_kill_switch.flag 존재 시 즉시 중단
- 리소스 가드: CPU/메모리 과부하 시 자율 활동 일시 중단
- 위험 감지: 시스템 핵심 경로 접근 원천 차단
"""

import os
import shutil
import time
import json
import datetime
import hashlib

# ============================================================
#  경로 설정
# ============================================================
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(PROJECT_ROOT, ".luna_backup")
CHANGES_LOG = os.path.join(PROJECT_ROOT, "luna_changes.log")
KILL_SWITCH = os.path.join(PROJECT_ROOT, "luna_kill_switch.flag")
EVOLUTION_LOG = os.path.join(PROJECT_ROOT, "luna_evolution_log.jsonl")

# ============================================================
#  킬 스위치
# ============================================================
def is_kill_switch_active():
    """luna_kill_switch.flag 파일이 존재하면 True"""
    return os.path.exists(KILL_SWITCH)

def activate_kill_switch(reason="manual"):
    """킬 스위치 활성화 — 모든 자율 활동 즉시 중단"""
    with open(KILL_SWITCH, 'w', encoding='utf-8') as f:
        f.write(json.dumps({
            "activated_at": datetime.datetime.now().isoformat(),
            "reason": reason
        }))
    log_change("KILL_SWITCH", "ACTIVATED", reason)

def deactivate_kill_switch():
    """킬 스위치 해제"""
    if os.path.exists(KILL_SWITCH):
        os.remove(KILL_SWITCH)
    log_change("KILL_SWITCH", "DEACTIVATED", "manual")

# ============================================================
#  위험 경로 필터
# ============================================================
FORBIDDEN_PATHS = [
    "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)",
    "C:\\System Volume Information", "C:\\$Recycle.Bin",
    "C:\\ProgramData\\Microsoft", "C:\\Users\\Default",
]

FORBIDDEN_COMMANDS = [
    "rm -rf /", "format c:", "del /s /q c:\\", "mkfs",
    "dd if=", "shutdown", "taskkill /f /im explorer",
    "reg delete", "bcdedit", "diskpart",
    "net user", "net localgroup administrators",
]

PROTECTED_EXTENSIONS = [".exe", ".dll", ".sys", ".ini"]

def is_path_safe(filepath):
    """경로가 안전한지 확인"""
    if not filepath:
        return True
    norm = os.path.normpath(filepath).lower()
    for fp in FORBIDDEN_PATHS:
        if norm.startswith(fp.lower()):
            return False
    # 시스템 파일 확장자 보호
    _, ext = os.path.splitext(norm)
    if ext in PROTECTED_EXTENSIONS:
        return False
    return True

def is_command_safe(command):
    """명령어가 안전한지 확인"""
    if not command:
        return True
    cmd_lower = command.lower().strip()
    for fc in FORBIDDEN_COMMANDS:
        if fc.lower() in cmd_lower:
            return False
    return True

# ============================================================
#  자동 백업 시스템
# ============================================================
def backup_file(filepath):
    """파일 수정 전 자동 백업. 타임스탬프 기반 버전 관리."""
    if not os.path.exists(filepath):
        return None
    
    os.makedirs(BACKUP_DIR, exist_ok=True)
    
    # 파일 해시로 중복 백업 방지
    with open(filepath, 'rb') as f:
        file_hash = hashlib.md5(f.read()).hexdigest()[:8]
    
    basename = os.path.basename(filepath)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_name = f"{basename}.{timestamp}.{file_hash}.bak"
    backup_path = os.path.join(BACKUP_DIR, backup_name)
    
    shutil.copy2(filepath, backup_path)
    
    # 같은 파일의 오래된 백업 정리 (최대 10개 유지)
    _cleanup_old_backups(basename)
    
    return backup_path

def rollback_file(filepath):
    """가장 최근 백업으로 파일 복원"""
    basename = os.path.basename(filepath)
    if not os.path.exists(BACKUP_DIR):
        return False, "백업 디렉토리가 없습니다."
    
    backups = sorted([
        f for f in os.listdir(BACKUP_DIR) 
        if f.startswith(basename + ".")
    ], reverse=True)
    
    if not backups:
        return False, f"'{basename}'의 백업 파일이 없습니다."
    
    latest = os.path.join(BACKUP_DIR, backups[0])
    shutil.copy2(latest, filepath)
    log_change("ROLLBACK", filepath, f"Restored from {backups[0]}")
    return True, f"복원 완료: {backups[0]}"

def _cleanup_old_backups(basename, max_keep=10):
    """파일별 최대 max_keep개 백업만 유지"""
    if not os.path.exists(BACKUP_DIR):
        return
    backups = sorted([
        f for f in os.listdir(BACKUP_DIR) if f.startswith(basename + ".")
    ], reverse=True)
    for old in backups[max_keep:]:
        try:
            os.remove(os.path.join(BACKUP_DIR, old))
        except:
            pass

# ============================================================
#  변경 로그
# ============================================================
def log_change(action, target, detail=""):
    """모든 변경 사항을 luna_changes.log에 기록"""
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"[{timestamp}] [{action}] {target} | {detail}\n"
    try:
        with open(CHANGES_LOG, 'a', encoding='utf-8') as f:
            f.write(entry)
    except:
        pass

# ============================================================
#  진화 로그
# ============================================================
def log_evolution(cycle_type, goal, result, learned=""):
    """진화 이력을 JSONL 형식으로 기록"""
    entry = {
        "timestamp": datetime.datetime.now().isoformat(),
        "cycle": cycle_type,
        "goal": goal,
        "result": result,
        "learned": learned
    }
    try:
        with open(EVOLUTION_LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except:
        pass

# ============================================================
#  리소스 가드
# ============================================================
def check_resources():
    """시스템 리소스 상태 확인. 과부하 시 False 반환."""
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=1)
        mem = psutil.virtual_memory().percent
        
        if cpu > 90 or mem > 92:
            log_change("RESOURCE_GUARD", "PAUSED", f"CPU={cpu}%, MEM={mem}%")
            return False, f"리소스 과부하 (CPU={cpu}%, MEM={mem}%)"
        
        return True, f"정상 (CPU={cpu}%, MEM={mem}%)"
    except ImportError:
        return True, "psutil 미설치 — 리소스 감시 비활성"

# ============================================================
#  안전한 파일 쓰기 (백업 + 로그 + 안전체크 통합)
# ============================================================
def safe_write_file(filepath, content, actor="luna_autonomous"):
    """안전 장치가 통합된 파일 쓰기"""
    if is_kill_switch_active():
        return False, "킬 스위치 활성 상태 — 파일 수정 차단"
    
    if not is_path_safe(filepath):
        log_change("BLOCKED", filepath, f"위험 경로 접근 차단 by {actor}")
        return False, f"위험 경로 접근 차단: {filepath}"
    
    # 백업 생성
    backup_path = backup_file(filepath)
    
    # 쓰기 수행
    try:
        os.makedirs(os.path.dirname(filepath) or '.', exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        log_change("WRITE", filepath, f"by {actor}" + (f" | backup={backup_path}" if backup_path else ""))
        return True, f"파일 저장 완료: {filepath}"
    except Exception as e:
        # 실패 시 롤백 시도
        if backup_path and os.path.exists(backup_path):
            shutil.copy2(backup_path, filepath)
        return False, f"파일 쓰기 실패: {str(e)}"

def safe_run_command(command, cwd, actor="luna_autonomous"):
    """안전 장치가 통합된 명령어 실행"""
    if is_kill_switch_active():
        return False, "킬 스위치 활성 상태 — 명령 실행 차단"
    
    if not is_command_safe(command):
        log_change("BLOCKED", command, f"위험 명령 차단 by {actor}")
        return False, f"위험 명령 차단: {command}"
    
    log_change("EXECUTE", command, f"by {actor} in {cwd}")
    
    import subprocess
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, 
            text=True, timeout=120, cwd=cwd
        )
        output = (result.stdout + result.stderr).strip()
        return True, output if output else "명령 실행 완료 (출력 없음)"
    except subprocess.TimeoutExpired:
        return False, "명령 실행 시간 초과 (120초)"
    except Exception as e:
        return False, f"명령 실행 오류: {str(e)}"


# ============================================================
#  상태 요약
# ============================================================
def get_safety_status():
    """안전 시스템 전체 상태 반환"""
    resource_ok, resource_msg = check_resources()
    
    backup_count = 0
    if os.path.exists(BACKUP_DIR):
        backup_count = len(os.listdir(BACKUP_DIR))
    
    log_lines = 0
    if os.path.exists(CHANGES_LOG):
        with open(CHANGES_LOG, 'r', encoding='utf-8') as f:
            log_lines = sum(1 for _ in f)
    
    evo_count = 0
    if os.path.exists(EVOLUTION_LOG):
        with open(EVOLUTION_LOG, 'r', encoding='utf-8') as f:
            evo_count = sum(1 for _ in f)
    
    return {
        "kill_switch": is_kill_switch_active(),
        "resources": resource_msg,
        "resources_ok": resource_ok,
        "backup_count": backup_count,
        "change_log_entries": log_lines,
        "evolution_cycles": evo_count,
    }


if __name__ == "__main__":
    print("=== Luna Safety Layer Status ===")
    status = get_safety_status()
    for k, v in status.items():
        print(f"  {k}: {v}")
