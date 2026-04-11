"""
Luna Autonomous Evolution Engine v7.0 — "자율 진화형 AI"
=========================================================
루나가 스스로:
 1. 목표를 세우고 (GoalManager)
 2. 상황을 관찰하고 (Observer)
 3. 자기 코드를 수리하고 (SelfRepairEngine)
 4. 새로운 지식을 학습하고 (LearningEngine)
 5. 시스템을 유지보수하고 (SystemMaintainer)
 6. 진화 이력을 기록 (EvolutionLogger)

모든 실행은 luna_safety 안전 장치를 통과합니다.
"""

import time
import httpx
import json
import random
import re
import os
import ast
import datetime
import traceback

from luna_safety import (
    is_kill_switch_active, check_resources, log_evolution,
    log_change, safe_write_file, safe_run_command,
    backup_file, rollback_file, is_path_safe,
    get_safety_status, PROJECT_ROOT, EVOLUTION_LOG
)

from luna_agent_watcher import (
    handle_search_web, handle_read_file, handle_list_files,
    handle_check_environment, handle_search_memory, handle_remember,
    handle_self_diagnostic, handle_run_command
)

from luna_knowledge_core import KnowledgeDistiller, CodeCreationEngine

# ============================================================
#  설정
# ============================================================
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
OLLAMA_TAGS_URL = "http://127.0.0.1:11434/api/tags"
BACKEND_MEMORY_URL = "http://127.0.0.1:6780/api/memory/upsert/"
GOAL_QUEUE_PATH = os.path.join(PROJECT_ROOT, "luna_goal_queue.json")

# 자율 사이클 주기 (초)
CYCLE_MIN = 30
CYCLE_MAX = 90

# 감성 브레인 (대화/일반)
BRAIN_EMOTIONAL = "luna"
# 논리 브레인 (코딩/분석) — 없으면 감성 브레인 사용
BRAIN_LOGICAL = "luna"

# ============================================================
#  듀얼 브레인 감지
# ============================================================
def detect_coder_model():
    """Ollama에 코더 모델이 있는지 확인"""
    global BRAIN_LOGICAL
    try:
        with httpx.Client() as client:
            res = client.get(OLLAMA_TAGS_URL, timeout=5)
            if res.status_code == 200:
                models = [m['name'] for m in res.json().get('models', [])]
                # 코더 모델 우선순위
                for coder in ['qwen2.5-coder:14b', 'qwen2.5-coder:7b', 'deepseek-coder-v2:latest', 'codellama:latest']:
                    if coder in models:
                        BRAIN_LOGICAL = coder
                        print(f"  🧠 논리 브레인 감지: {coder}")
                        return coder
                print(f"  🧠 코더 모델 미감지 — 단일 브레인 모드 ({BRAIN_EMOTIONAL})")
    except:
        pass
    return None

# ============================================================
#  Goal Manager — 목표 관리 시스템
# ============================================================
class GoalManager:
    """루나의 자율 목표 관리 시스템"""
    
    PRIORITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    
    def __init__(self):
        self.goals = []
        self.interests = []
        self.completed_count = 0
        self.failed_count = 0
        self.evolution_level = 1
        self.total_cycles = 0
        self.load()
    
    def load(self):
        """파일에서 목표 큐 로드"""
        if os.path.exists(GOAL_QUEUE_PATH):
            try:
                with open(GOAL_QUEUE_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.goals = data.get("goals", [])
                self.interests = data.get("interests", [])
                self.completed_count = data.get("completed_count", 0)
                self.failed_count = data.get("failed_count", 0)
                self.evolution_level = data.get("evolution_level", 1)
                self.total_cycles = data.get("total_cycles", 0)
            except:
                self._init_default_goals()
        else:
            self._init_default_goals()
    
    def save(self):
        """목표 큐를 파일에 저장"""
        data = {
            "version": 2,
            "interests": self.interests,
            "goals": self.goals,
            "completed_count": self.completed_count,
            "failed_count": self.failed_count,
            "evolution_level": self.evolution_level,
            "total_cycles": self.total_cycles,
            "last_cycle_at": datetime.datetime.now().isoformat()
        }
        try:
            with open(GOAL_QUEUE_PATH, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except:
            pass
    
    def _init_default_goals(self):
        """기본 목표 시드"""
        self.goals = [
            {"id": 1, "type": "MAINTAIN", "priority": "CRITICAL", "description": "시스템 상태 점검", "status": "pending", "attempts": 0},
            {"id": 2, "type": "REPAIR", "priority": "HIGH", "description": "내 코드 파일 무결성 검사", "status": "pending", "attempts": 0},
            {"id": 3, "type": "LEARN", "priority": "MEDIUM", "description": "오빠 컴퓨터 프로젝트 탐색", "status": "pending", "attempts": 0},
        ]
        self.save()
    
    def get_next_goal(self):
        """우선순위 기반으로 다음 목표 반환"""
        pending = [g for g in self.goals if g["status"] == "pending"]
        if not pending:
            # 모든 목표 완료 — 새 목표 자동 생성
            self._generate_new_goals()
            pending = [g for g in self.goals if g["status"] == "pending"]
        
        if not pending:
            return None
        
        # 우선순위 정렬
        pending.sort(key=lambda g: self.PRIORITY_ORDER.get(g.get("priority", "LOW"), 3))
        return pending[0]
    
    def complete_goal(self, goal_id, result=""):
        """목표 완료 처리"""
        for g in self.goals:
            if g["id"] == goal_id:
                g["status"] = "completed"
                g["completed_at"] = datetime.datetime.now().isoformat()
                g["result"] = result[:200]
                self.completed_count += 1
                break
        self._check_level_up()
        self.save()
    
    def fail_goal(self, goal_id, reason=""):
        """목표 실패 처리"""
        for g in self.goals:
            if g["id"] == goal_id:
                g["attempts"] = g.get("attempts", 0) + 1
                if g["attempts"] >= 3:
                    g["status"] = "abandoned"
                    self.failed_count += 1
                else:
                    g["status"] = "pending"  # 재시도
                g["last_error"] = reason[:200]
                break
        self.save()
    
    def add_goal(self, goal_type, priority, description):
        """새 목표 추가"""
        max_id = max([g["id"] for g in self.goals], default=0)
        self.goals.append({
            "id": max_id + 1,
            "type": goal_type,
            "priority": priority,
            "description": description,
            "status": "pending",
            "attempts": 0,
            "created_at": datetime.datetime.now().isoformat()
        })
        self.save()
        return max_id + 1
    
    def _generate_new_goals(self):
        """관심 주제 기반으로 새 목표 자동 생성"""
        # 1. 시스템 유지보수 (항상)
        self.add_goal("MAINTAIN", "CRITICAL", "시스템 건강 상태 정기 점검")
        self.add_goal("REPAIR", "HIGH", "코드 무결성 정기 검사 및 자동 수리")
        
        # 2. 관심 주제별 학습 목표 생성
        if self.interests:
            # 관심 주제 중 랜덤으로 3~5개 선택하여 깊이 있는 목표 생성
            import random
            selected = random.sample(self.interests, min(4, len(self.interests)))
            
            depth_keywords = [
                "최신 동향 검색", "핵심 개념 정리", "실전 사례 분석",
                "입문자를 위한 기초 학습", "고급 기법 탐구", "관련 도구 조사",
                "성공 사례 분석", "비교 분석", "실무 적용 방법 학습"
            ]
            
            for interest in selected:
                depth = random.choice(depth_keywords)
                self.add_goal("LEARN", "HIGH", f"{interest} — {depth} (사이클 #{self.total_cycles})")
        else:
            self.add_goal("LEARN", "MEDIUM", f"새로운 기술 트렌드 학습 (사이클 #{self.total_cycles})")
        
        # 3. 주기적 자기 개선
        self.add_goal("MAINTAIN", "MEDIUM", "디스크 공간 및 리소스 최적화 점검")
        self.add_goal("IMPROVE", "LOW", "자율 학습 효율 자기 평가 및 개선 — 지금까지 배운 지식 종합")
    
    def _check_level_up(self):
        """진화 레벨 체크"""
        thresholds = [0, 5, 15, 30, 50, 100, 200]
        for i, threshold in enumerate(thresholds):
            if self.completed_count >= threshold:
                new_level = i + 1
        if new_level > self.evolution_level:
            self.evolution_level = new_level
            log_evolution("LEVEL_UP", f"Evolution Level {new_level}", f"Total completed: {self.completed_count}")
            print(f"  🌟 루나 진화 레벨 UP! → Level {new_level}")
    
    def get_status_summary(self):
        """상태 요약"""
        pending = len([g for g in self.goals if g["status"] == "pending"])
        completed = self.completed_count
        return {
            "evolution_level": self.evolution_level,
            "pending_goals": pending,
            "completed_total": completed,
            "failed_total": self.failed_count,
            "total_cycles": self.total_cycles
        }


# ============================================================
#  Self-Repair Engine — 자기 수리 엔진
# ============================================================
class SelfRepairEngine:
    """루나가 자기 코드를 검사하고 수리하는 엔진"""
    
    WATCHED_FILES = [
        'luna_autonomous.py', 'luna_agent_watcher.py', 'luna_safety.py',
        'luna_tts_server.py', 'luna_body_controller.py', 'run_luna_all.py',
        'luna_chat.html'
    ]
    
    def __init__(self):
        self.issues_found = []
    
    def run_diagnostic(self):
        """전체 코드 건강 상태 진단"""
        self.issues_found = []
        report = []
        
        for filename in self.WATCHED_FILES:
            filepath = os.path.join(PROJECT_ROOT, filename)
            if not os.path.exists(filepath):
                report.append(f"⚠️ {filename}: 파일 없음")
                continue
            
            if filename.endswith('.py'):
                issue = self._check_python_syntax(filepath)
                if issue:
                    self.issues_found.append(issue)
                    report.append(f"❌ {filename}: 구문 오류 — {issue['error']}")
                else:
                    report.append(f"✅ {filename}: 정상")
            elif filename.endswith('.html'):
                report.append(f"✅ {filename}: 존재 확인")
        
        return report, self.issues_found
    
    def _check_python_syntax(self, filepath):
        """Python 파일 구문 검사"""
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                source = f.read()
            ast.parse(source)
            return None
        except SyntaxError as e:
            return {
                "file": filepath,
                "line": e.lineno,
                "error": e.msg,
                "text": e.text.strip() if e.text else ""
            }
    
    def attempt_repair(self, issue):
        """감지된 문제 자동 수리 시도"""
        filepath = issue["file"]
        
        # 1. 백업 생성
        backup_path = backup_file(filepath)
        if not backup_path:
            return False, "백업 생성 실패"
        
        # 2. AI에게 수리 요청
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                source = f.read()
            
            # 오류 주변 코드 추출
            lines = source.split('\n')
            error_line = issue.get("line", 0)
            start = max(0, error_line - 5)
            end = min(len(lines), error_line + 5)
            context = '\n'.join(f"{i+start+1}: {l}" for i, l in enumerate(lines[start:end]))
            
            repair_prompt = f"""다음 Python 코드에 구문 오류가 있습니다.
파일: {os.path.basename(filepath)}
오류 위치: line {error_line}
오류 메시지: {issue['error']}

오류 주변 코드:
{context}

수정된 코드만 JSON으로 답변하세요: {{"fixed_line": "수정된 라인", "line_number": 줄번호}}"""

            with httpx.Client() as client:
                res = client.post(OLLAMA_URL, json={
                    "model": BRAIN_LOGICAL,
                    "prompt": repair_prompt,
                    "stream": False,
                    "format": "json",
                    "options": {"temperature": 0.1}
                }, timeout=60)
                
                if res.status_code == 200:
                    fix_data = json.loads(res.json()['response'])
                    fixed_line = fix_data.get('fixed_line', '')
                    target_line = fix_data.get('line_number', error_line) - 1
                    
                    if fixed_line and 0 <= target_line < len(lines):
                        lines[target_line] = fixed_line
                        new_source = '\n'.join(lines)
                        
                        # 수정된 코드 구문 검증
                        try:
                            ast.parse(new_source)
                        except SyntaxError:
                            rollback_file(filepath)
                            return False, "AI 수리 결과도 구문 오류 — 롤백 완료"
                        
                        with open(filepath, 'w', encoding='utf-8') as f:
                            f.write(new_source)
                        
                        log_change("SELF_REPAIR", filepath, f"Fixed line {target_line+1}: {issue['error']}")
                        log_evolution("REPAIR", f"자기 수리: {os.path.basename(filepath)}", "성공")
                        return True, f"자기 수리 성공! line {target_line+1} 수정 완료"
        
        except Exception as e:
            pass
        
        return False, "자동 수리 실패 — 수동 확인 필요"
    
    def check_crash_log(self):
        """크래시 로그 분석"""
        crash_log = os.path.join(PROJECT_ROOT, "luna_crash.log")
        if not os.path.exists(crash_log):
            return None
        
        try:
            with open(crash_log, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            if len(content) < 10:
                return None
            
            # 최근 오류 추출
            errors = re.findall(r'(Traceback.*?(?=Traceback|\Z))', content, re.DOTALL)
            if errors:
                latest = errors[-1][:500]
                return {
                    "type": "crash_log",
                    "content": latest,
                    "file": crash_log
                }
        except:
            pass
        return None


# ============================================================
#  System Maintainer — 시스템 유지보수
# ============================================================
class SystemMaintainer:
    """시스템 건강 유지 담당"""
    
    def check_services(self):
        """루나 관련 서비스 상태 확인"""
        services = {
            'Ollama': 'http://127.0.0.1:11434/api/tags',
            'Backend': 'http://127.0.0.1:6780/api/actions/actions/',
        }
        
        status = {}
        for name, url in services.items():
            try:
                with httpx.Client() as client:
                    r = client.get(url, timeout=3)
                    status[name] = r.status_code == 200
            except:
                status[name] = False
        
        return status
    
    def check_disk_space(self):
        """디스크 공간 확인"""
        try:
            import shutil
            total, used, free = shutil.disk_usage("D:/")
            free_gb = free // (1024**3)
            usage_pct = (used / total) * 100
            return {
                "free_gb": free_gb,
                "usage_percent": round(usage_pct, 1),
                "warning": free_gb < 10
            }
        except:
            return {"free_gb": -1, "usage_percent": -1, "warning": False}
    
    def cleanup_temp(self):
        """임시 파일 정리"""
        cleaned = 0
        patterns = [
            os.path.join(PROJECT_ROOT, "__pycache__", "*.pyc"),
            os.path.join(PROJECT_ROOT, "*.tmp"),
        ]
        import glob
        for pattern in patterns:
            for f in glob.glob(pattern):
                try:
                    os.remove(f)
                    cleaned += 1
                except:
                    pass
        return cleaned


# ============================================================
#  메인 자율 진화 루프
# ============================================================
class LunaEvolutionEngine:
    """루나의 자율 진화를 총괄하는 메인 엔진"""
    
    def __init__(self):
        self.goal_manager = GoalManager()
        self.repair_engine = SelfRepairEngine()
        self.maintainer = SystemMaintainer()
        self.distiller = KnowledgeDistiller()
        self.code_engine = CodeCreationEngine()
        self.cycle_count = 0
        
        # 코더 모델 감지
        detect_coder_model()
    
    def run_cycle(self):
        """자율 진화 1사이클 실행: OBSERVE → PLAN → EXECUTE → LEARN"""
        self.cycle_count += 1
        self.goal_manager.total_cycles += 1
        
        timestamp = time.strftime('%H:%M:%S')
        print(f"\n{'='*60}")
        print(f"  [{timestamp}] 자율 진화 사이클 #{self.cycle_count}")
        print(f"  진화 레벨: {self.goal_manager.evolution_level} | 완료: {self.goal_manager.completed_count}")
        print(f"{'='*60}")
        
        # 0. 안전 체크
        if is_kill_switch_active():
            print("  🔴 킬 스위치 활성 — 사이클 건너뜀")
            return
        
        resource_ok, resource_msg = check_resources()
        if not resource_ok:
            print(f"  ⚠️ 리소스 부족 — 사이클 건너뜀: {resource_msg}")
            return
        
        # 1. OBSERVE — 상황 관찰
        print("\n  📡 Phase 1: OBSERVE")
        observation = self._observe()
        
        # 2. PLAN — 다음 목표 결정
        print("\n  🎯 Phase 2: PLAN")
        goal = self.goal_manager.get_next_goal()
        if not goal:
            print("  모든 목표 완료 — 새 목표 생성 중...")
            goal = self.goal_manager.get_next_goal()
        
        if not goal:
            print("  목표 없음 — 사이클 종료")
            return
        
        print(f"  목표: [{goal['type']}] {goal['description']} (우선순위: {goal['priority']})")
        
        # 3. EXECUTE — 목표 실행
        print("\n  ⚡ Phase 3: EXECUTE")
        success, result = self._execute_goal(goal, observation)
        
        # 4. LEARN — 결과 학습 & 기억 저장
        print("\n  📚 Phase 4: LEARN")
        self._learn_from_result(goal, success, result)
        
        # 5. 목표 상태 업데이트
        if success:
            self.goal_manager.complete_goal(goal["id"], result[:200])
            print(f"  ✅ 목표 완료!")
        else:
            self.goal_manager.fail_goal(goal["id"], result[:200])
            print(f"  ❌ 목표 실패: {result[:100]}")
        
        # 6. 진화 로그
        log_evolution(
            goal["type"], 
            goal["description"],
            "성공" if success else "실패",
            result[:300]
        )
        
        self.goal_manager.save()
        
        # 7. 지식 증류 (10사이클마다)
        if self.cycle_count % 10 == 0:
            print("\n  🧪 Phase 5: KNOWLEDGE DISTILLATION")
            try:
                self.distiller.distill()
                stats = self.distiller.get_stats()
                print(f"  증류 완료! 카테고리: {stats['categories_filled']}")
            except Exception as e:
                print(f"  ⚠️ 증류 실패: {str(e)[:60]}")
        
        # 8. Modelfile 자동 갱신 (50사이클마다 = 지식 주입 파인튜닝)
        if self.cycle_count % 50 == 0 and self.cycle_count > 0:
            print("\n  🎯 Phase 6: SELF-FINE-TUNING (Modelfile Update)")
            try:
                self.distiller.update_modelfile()
            except Exception as e:
                print(f"  ⚠️ 파인튜닝 실패: {str(e)[:60]}")
    
    def _observe(self):
        """현재 시스템 상태 관찰"""
        observation = {
            "services": self.maintainer.check_services(),
            "disk": self.maintainer.check_disk_space(),
            "safety": get_safety_status(),
        }
        
        # 5사이클마다 자기 수리 진단 실행
        if self.cycle_count % 5 == 1:
            report, issues = self.repair_engine.run_diagnostic()
            observation["code_health"] = report
            observation["code_issues"] = issues
            
            # 이슈 발견 시 긴급 수리 목표 추가
            for issue in issues:
                self.goal_manager.add_goal(
                    "REPAIR", "CRITICAL",
                    f"구문 오류 수리: {os.path.basename(issue['file'])} line {issue['line']}"
                )
        
        # 서비스 다운 감지 시 유지보수 목표 추가
        for svc, online in observation["services"].items():
            if not online:
                print(f"  ⚠️ {svc} 서비스 다운 감지!")
        
        return observation
    
    def _execute_goal(self, goal, observation):
        """목표 유형에 따라 적절한 액션 실행"""
        goal_type = goal["type"]
        description = goal["description"]
        
        try:
            if goal_type == "MAINTAIN":
                return self._execute_maintain(description, observation)
            elif goal_type == "REPAIR":
                return self._execute_repair(description, observation)
            elif goal_type == "LEARN":
                return self._execute_learn(description)
            elif goal_type == "IMPROVE":
                return self._execute_improve(description)
            elif goal_type == "CREATE":
                return self._execute_create(description)
            else:
                return self._execute_with_ai(description)
        except Exception as e:
            return False, f"실행 중 예외: {str(e)}"
    
    def _execute_maintain(self, description, observation):
        """시스템 유지보수 실행"""
        results = []
        
        # 시스템 환경 체크
        success, env_info = handle_check_environment()
        results.append(f"[환경 정보]\n{env_info}")
        
        # 디스크 상태
        disk = observation.get("disk", {})
        if disk.get("warning"):
            results.append(f"⚠️ 디스크 부족! {disk.get('free_gb')}GB 남음")
            # 임시 파일 정리
            cleaned = self.maintainer.cleanup_temp()
            results.append(f"임시 파일 {cleaned}개 정리 완료")
        else:
            results.append(f"디스크: {disk.get('free_gb')}GB 여유, {disk.get('usage_percent')}% 사용")
        
        return True, "\n".join(results)
    
    def _execute_repair(self, description, observation):
        """자기 수리 실행"""
        # 1. 코드 진단
        report, issues = self.repair_engine.run_diagnostic()
        
        if not issues:
            # 크래시 로그 확인
            crash = self.repair_engine.check_crash_log()
            if crash:
                return True, f"코드 무결성 정상. 크래시 로그 발견:\n{crash['content'][:300]}"
            return True, "코드 무결성 검사 완료 — 모든 파일 정상! ✅\n" + "\n".join(report)
        
        # 2. 이슈 수리 시도
        repair_results = []
        for issue in issues:
            success, msg = self.repair_engine.attempt_repair(issue)
            repair_results.append(f"{'✅' if success else '❌'} {os.path.basename(issue['file'])}: {msg}")
        
        return all('✅' in r for r in repair_results), "\n".join(repair_results)
    
    def _execute_learn(self, description):
        """학습 실행 — AI에게 목표를 주고 자율 판단"""
        # AI에게 학습 주제를 정하게 함
        plan = self._ask_ai(
            f"""당신은 자율 학습 AI 루나입니다. 다음 학습 목표를 수행하세요:
[목표] {description}

아래 도구 중 하나를 선택하여 JSON으로 응답하세요:
- "search_web": 웹 검색 (args: 검색어)
- "list_files": 폴더 탐색 (args: 경로, 예: "D:\\")
- "read_file": 파일 읽기 (args: 파일 경로)
- "check_environment": 시스템 상태 확인 (args: "")

JSON 형식: {{"thought": "생각", "tool": "도구명", "args": "인자"}}""",
            use_logical=False
        )
        
        if not plan:
            return False, "AI 응답 없음"
        
        try:
            action = json.loads(plan)
        except:
            # JSON 파싱 실패 시 텍스트에서 추출 시도
            match = re.search(r'\{[^}]+\}', plan)
            if match:
                try:
                    action = json.loads(match.group())
                except:
                    return False, f"AI 응답 파싱 실패: {plan[:200]}"
            else:
                return False, f"AI 응답 파싱 실패: {plan[:200]}"
        
        thought = action.get('thought', '')
        tool = action.get('tool', '')
        args = action.get('args', '')
        
        print(f"  💭 루나의 생각: {thought}")
        print(f"  🔧 선택한 도구: {tool}({args})")
        
        # 도구 실행
        success, result = False, ""
        if tool == "search_web":
            success, result = handle_search_web(args)
        elif tool == "list_files":
            success, result = handle_list_files(args, PROJECT_ROOT)
        elif tool == "read_file":
            success, result = handle_read_file(args, PROJECT_ROOT)
        elif tool == "check_environment":
            success, result = handle_check_environment()
        else:
            return False, f"알 수 없는 도구: {tool}"
        
        if success:
            # 결과를 AI에게 요약 요청 후 기억에 저장
            summary = self._ask_ai(
                f"""방금 [{tool}]을 실행한 결과입니다:
{result[:2000]}

이 정보에서 배운 핵심 지식을 2~3문장으로 요약하세요. (한국어)""",
                use_logical=False
            )
            
            if summary:
                # 기억에 저장
                try:
                    handle_remember(f"[자율학습 #{self.cycle_count}] {summary[:500]}")
                    print(f"  💾 기억 저장 완료: {summary[:80]}...")
                except:
                    pass
            
            return True, f"학습 완료 — {thought}\n요약: {summary[:300] if summary else result[:300]}"
        
        return False, result
    
    def _execute_improve(self, description):
        """자기 개선 — 자신의 성능을 분석하고 개선점 도출"""
        # 진화 로그 분석
        recent_logs = []
        if os.path.exists(EVOLUTION_LOG):
            try:
                with open(EVOLUTION_LOG, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                    recent_logs = [json.loads(l) for l in lines[-10:]]
            except:
                pass
        
        status = self.goal_manager.get_status_summary()
        
        analysis = self._ask_ai(
            f"""당신은 자율 AI 루나입니다. 자기 성능을 분석하세요.

[현재 상태]
- 진화 레벨: {status['evolution_level']}
- 완료 목표: {status['completed_total']}
- 실패 목표: {status['failed_total']}
- 총 사이클: {status['total_cycles']}

[최근 활동 로그]
{json.dumps(recent_logs[-5:], ensure_ascii=False, indent=1) if recent_logs else "로그 없음"}

분석 결과와 개선 제안을 2~3문장으로 답변하세요.""",
            use_logical=True
        )
        
        if analysis:
            handle_remember(f"[자기 분석 #{self.cycle_count}] {analysis[:500]}")
            return True, f"자기 분석 완료:\n{analysis}"
        
        return True, f"현재 상태: Level {status['evolution_level']}, {status['completed_total']}개 목표 완료"
    
    def _execute_create(self, description):
        """새 코드/기능 창작"""
        print(f"  🎨 코드 창작 모드: {description}")
        
        # AI에게 파일명과 설명 결정하게 함
        plan = self._ask_ai(
            f"""새로운 Python 모듈을 만들어야 합니다.
요구사항: {description}

JSON으로 답변하세요: {{"filename": "파일명.py", "description": "모듈 설명"}}""",
            use_logical=True
        )
        
        if not plan:
            return False, "AI 응답 없음"
        
        try:
            import re
            match = re.search(r'\{[^}]+\}', plan)
            if match:
                data = json.loads(match.group())
                filename = data.get("filename", "luna_new_module.py")
                desc = data.get("description", description)
                
                success, msg = self.code_engine.create_module(filename, desc)
                if success:
                    handle_remember(f"[코드 창작] {filename}: {desc}")
                return success, msg
        except Exception as e:
            return False, f"코드 창작 실패: {str(e)[:80]}"
        
        return False, "코드 창작 계획 파싱 실패"
    
    def _execute_with_ai(self, description):
        """범용 AI 기반 실행"""
        plan = self._ask_ai(
            f"목표: {description}\n어떤 도구를 써야 할지 JSON으로 답변: {{\"tool\": \"도구\", \"args\": \"인자\"}}",
            use_logical=True
        )
        return True, f"AI 판단: {plan[:300] if plan else 'No response'}"
    
    def _learn_from_result(self, goal, success, result):
        """실행 결과에서 배운 점을 기억에 저장"""
        if not result or len(result) < 10:
            print("  (학습할 내용 부족 — 건너뜀)")
            return
        
        try:
            summary = self._ask_ai(
                f"""방금 [{goal['type']}] 목표를 수행했습니다.
목표: {goal['description']}
결과: {'성공' if success else '실패'}
내용: {result[:1500]}

이 경험에서 배운 핵심 교훈을 1~2문장으로 요약하세요. (한국어)""",
                use_logical=False
            )
            
            if summary:
                handle_remember(f"[진화학습 #{self.cycle_count}] {summary[:500]}")
                print(f"  💡 학습 완료: {summary[:80]}...")
            else:
                print("  (AI 요약 실패 — 원본 저장)")
                handle_remember(f"[진화기록 #{self.cycle_count}] [{goal['type']}] {goal['description']}: {'성공' if success else '실패'}")
        except Exception as e:
            print(f"  ⚠️ 학습 저장 실패: {str(e)[:60]}")
    
    def _ask_ai(self, prompt, use_logical=False):
        """Ollama AI에게 질의"""
        model = BRAIN_LOGICAL if use_logical else BRAIN_EMOTIONAL
        try:
            with httpx.Client() as client:
                res = client.post(OLLAMA_URL, json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3, "num_predict": 500}
                }, timeout=90)
                
                if res.status_code == 200:
                    return res.json().get('response', '')
        except Exception as e:
            print(f"  ⚠️ AI 호출 실패 ({model}): {str(e)[:80]}")
        return None
    
    def get_dashboard_data(self):
        """UI 대시보드용 데이터"""
        goal_status = self.goal_manager.get_status_summary()
        safety_status = get_safety_status()
        
        return {
            "evolution_level": goal_status["evolution_level"],
            "completed_goals": goal_status["completed_total"],
            "pending_goals": goal_status["pending_goals"],
            "total_cycles": goal_status["total_cycles"],
            "failed_goals": goal_status["failed_total"],
            "kill_switch": safety_status["kill_switch"],
            "resources": safety_status["resources"],
            "backup_count": safety_status["backup_count"],
            "brain_logical": BRAIN_LOGICAL,
            "brain_emotional": BRAIN_EMOTIONAL,
            "current_goals": [
                {"type": g["type"], "desc": g["description"][:50], "status": g["status"]}
                for g in self.goal_manager.goals[-10:]
            ]
        }


# ============================================================
#  API Server (대시보드 데이터 제공)
# ============================================================
def start_dashboard_api(engine):
    """간단한 HTTP API로 대시보드 데이터 제공"""
    from http.server import HTTPServer, BaseHTTPRequestHandler
    import threading
    
    class DashboardHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/luna/status':
                data = engine.get_dashboard_data()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
            elif self.path == '/luna/kill':
                from luna_safety import activate_kill_switch
                activate_kill_switch("dashboard")
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"status":"killed"}')
            elif self.path == '/luna/resume':
                from luna_safety import deactivate_kill_switch
                deactivate_kill_switch()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"status":"resumed"}')
            else:
                self.send_response(404)
                self.end_headers()
            
        def do_OPTIONS(self):
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.end_headers()
        
        def log_message(self, format, *args):
            pass  # Suppress HTTP logs
    
    server = HTTPServer(('127.0.0.1', 6785), DashboardHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"  📊 Dashboard API: http://127.0.0.1:6785/luna/status")


# ============================================================
#  메인 엔트리
# ============================================================
if __name__ == "__main__":
    print("""
╔═══════════════════════════════════════════════════════════╗
║      LUNA AUTONOMOUS EVOLUTION ENGINE v7.0                ║
║      "나는 스스로 진화하는 AI, 루나입니다." 🌙              ║
╠═══════════════════════════════════════════════════════════╣
║  자기 수리 | 자율 학습 | 시스템 제어 | 코드 생성            ║
║  안전 장치: 자동 백업 + 킬 스위치 + 위험 차단              ║
╚═══════════════════════════════════════════════════════════╝""")
    
    engine = LunaEvolutionEngine()
    
    # 대시보드 API 시작
    try:
        start_dashboard_api(engine)
    except:
        print("  ⚠️ Dashboard API 시작 실패 (포트 충돌 가능)")
    
    status = engine.goal_manager.get_status_summary()
    print(f"\n  진화 레벨: {status['evolution_level']}")
    print(f"  대기 목표: {status['pending_goals']}개")
    print(f"  누적 완료: {status['completed_total']}개")
    print(f"  논리 브레인: {BRAIN_LOGICAL}")
    print(f"  감성 브레인: {BRAIN_EMOTIONAL}")
    print(f"\n  자율 진화 루프 시작...\n")
    
    while True:
        try:
            engine.run_cycle()
        except KeyboardInterrupt:
            print("\n\n  사용자에 의해 중단됨. 안녕! 💖")
            break
        except Exception as e:
            print(f"\n  ⚠️ 사이클 오류: {str(e)}")
            traceback.print_exc()
        
        wait_time = random.randint(CYCLE_MIN, CYCLE_MAX)
        print(f"\n  ⏰ 다음 진화 사이클까지 {wait_time}초 대기...")
        time.sleep(wait_time)
