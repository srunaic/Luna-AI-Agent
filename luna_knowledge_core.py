"""
Luna Knowledge Distillation Engine
====================================
축적된 기억을 핵심 지식으로 압축하여:
1. 시스템 프롬프트에 주입 (Modelfile 자동 갱신)
2. 대화 시 핵심 컨텍스트로 활용
3. 진화할수록 기억 검색 품질 향상

이것이 "파인튜닝 없는 파인튜닝" — 지식 증류 방식.
"""

import os
import json
import datetime
import httpx

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
MEMORY_SEARCH_URL = "http://127.0.0.1:6780/api/memory/search/"
KNOWLEDGE_CORE_PATH = os.path.join(PROJECT_ROOT, "luna_knowledge_core.json")
MODELFILE_PATH = os.path.join(PROJECT_ROOT, "Luna-Modelfile")

class KnowledgeDistiller:
    """
    루나의 기억을 주기적으로 압축→핵심 지식 추출→모델에 주입
    """
    
    def __init__(self):
        self.knowledge_core = self._load_core()
    
    def _load_core(self):
        """저장된 핵심 지식 로드"""
        if os.path.exists(KNOWLEDGE_CORE_PATH):
            try:
                with open(KNOWLEDGE_CORE_PATH, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
        return {
            "version": 1,
            "last_distilled": None,
            "distill_count": 0,
            "knowledge_categories": {
                "AI_기술": [],
                "법률_지식": [],
                "프로그래밍": [],
                "게임_제작": [],
                "마케팅_수익화": [],
                "VTuber_방송": [],
                "대화_심리학": [],
                "보안_해킹방어": [],
                "시스템_운영": [],
                "기타_학습": []
            },
            "condensed_prompt": ""
        }
    
    def _save_core(self):
        """핵심 지식 저장"""
        try:
            with open(KNOWLEDGE_CORE_PATH, 'w', encoding='utf-8') as f:
                json.dump(self.knowledge_core, f, ensure_ascii=False, indent=2)
        except:
            pass
    
    def distill(self, model="luna"):
        """
        전체 기억에서 핵심 지식을 추출하여 카테고리별로 정리.
        이 과정을 '지식 증류(Knowledge Distillation)'라고 합니다.
        """
        print("  🧪 지식 증류 시작...")
        
        # 1. 기억 DB에서 주요 키워드별 검색
        categories_keywords = {
            "AI_기술": ["AI", "인공지능", "머신러닝", "딥러닝", "GPT", "LLM"],
            "법률_지식": ["법률", "법", "헌법", "저작권", "규제", "AI법"],
            "프로그래밍": ["Python", "JavaScript", "코딩", "알고리즘", "프로그래밍"],
            "게임_제작": ["게임", "Unity", "Unreal", "게임 디자인"],
            "마케팅_수익화": ["마케팅", "수익", "SEO", "비즈니스", "돈"],
            "VTuber_방송": ["VTuber", "유튜버", "방송", "스트리밍", "OBS"],
            "대화_심리학": ["대화", "공감", "심리", "커뮤니케이션", "설득"],
            "보안_해킹방어": ["보안", "해킹", "방화벽", "암호화", "사이버"],
            "시스템_운영": ["시스템", "서버", "프로세스", "디스크", "CPU"],
        }
        
        all_knowledge = {}
        
        for category, keywords in categories_keywords.items():
            memories = []
            for keyword in keywords:
                try:
                    with httpx.Client() as client:
                        res = client.post(MEMORY_SEARCH_URL, json={
                            "query": keyword, "top_k": 5
                        }, timeout=10)
                        if res.status_code == 200:
                            results = res.json().get("results", [])
                            for r in results:
                                text = r.get("text", "")
                                if text and len(text) > 20 and text not in memories:
                                    memories.append(text)
                except:
                    pass
            
            all_knowledge[category] = memories
        
        # 2. AI에게 각 카테고리 핵심 요약 요청
        condensed = {}
        for category, memories in all_knowledge.items():
            if not memories:
                continue
            
            combined = "\n".join([f"- {m[:200]}" for m in memories[:10]])
            
            try:
                with httpx.Client() as client:
                    res = client.post(OLLAMA_URL, json={
                        "model": model,
                        "prompt": f"""다음은 [{category}] 분야에서 축적된 학습 기록입니다:
{combined}

이 내용에서 가장 중요한 핵심 지식을 3줄 이내로 압축 요약하세요. 
불필요한 인사말이나 감정 표현 없이, 순수한 지식만 작성하세요.""",
                        "stream": False,
                        "options": {"temperature": 0.1, "num_predict": 200}
                    }, timeout=120)
                    
                    if res.status_code == 200:
                        summary = res.json().get("response", "").strip()
                        if summary and len(summary) > 10:
                            condensed[category] = summary
                            print(f"    ✅ {category}: {summary[:60]}...")
            except Exception as e:
                print(f"    ⚠️ {category} 증류 실패: {str(e)[:50]}")
        
        # 3. 핵심 지식 코어 업데이트
        for category, summary in condensed.items():
            existing = self.knowledge_core["knowledge_categories"].get(category, [])
            if summary not in existing:
                existing.append(summary)
                # 카테고리당 최대 5개 유지 (오래된 것 제거)
                if len(existing) > 5:
                    existing = existing[-5:]
                self.knowledge_core["knowledge_categories"][category] = existing
        
        # 4. 통합 프롬프트 생성
        prompt_parts = []
        for cat, summaries in self.knowledge_core["knowledge_categories"].items():
            if summaries:
                cat_name = cat.replace("_", " ")
                latest = summaries[-1]  # 가장 최신 요약
                prompt_parts.append(f"[{cat_name}] {latest}")
        
        if prompt_parts:
            self.knowledge_core["condensed_prompt"] = "\n".join(prompt_parts)
        
        self.knowledge_core["last_distilled"] = datetime.datetime.now().isoformat()
        self.knowledge_core["distill_count"] = self.knowledge_core.get("distill_count", 0) + 1
        self._save_core()
        
        print(f"  🧪 지식 증류 완료! {len(condensed)}개 카테고리 업데이트")
        return condensed
    
    def get_knowledge_prompt(self):
        """대화에 주입할 지식 프롬프트 반환"""
        prompt = self.knowledge_core.get("condensed_prompt", "")
        if prompt:
            return f"\n[축적된 핵심 지식]\n{prompt}\n"
        return ""
    
    def update_modelfile(self):
        """Modelfile에 핵심 지식을 주입하여 모델 업데이트 (자동 파인튜닝)"""
        knowledge = self.get_knowledge_prompt()
        if not knowledge or len(knowledge) < 50:
            print("  ⚠️ 아직 지식이 충분하지 않아 Modelfile 업데이트 건너뜀")
            return False
        
        try:
            with open(MODELFILE_PATH, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # [축적된 핵심 지식] 섹션이 있으면 교체, 없으면 추가
            if "[축적된 핵심 지식]" in content:
                # 기존 지식 섹션 교체
                import re
                content = re.sub(
                    r'\[축적된 핵심 지식\].*?(?=\[|PARAMETER|""")',
                    knowledge.strip() + "\n\n",
                    content,
                    flags=re.DOTALL
                )
            else:
                # SYSTEM 프롬프트의 끝 부분에 지식 삽입
                content = content.replace(
                    '"""',
                    f'\n{knowledge}\n"""',
                    1  # 첫 번째 """만 (SYSTEM 시작)은 건드리지 않음
                )
                # 두 번째 """(닫는 따옴표) 앞에 삽입되도록 수정
                parts = content.split('"""')
                if len(parts) >= 3:
                    # parts[0] = FROM...\nSYSTEM
                    # parts[1] = 시스템 프롬프트 내용
                    # parts[2] = PARAMETER...
                    parts[1] = parts[1].rstrip() + f"\n\n{knowledge}\n"
                    content = '"""'.join(parts)
            
            with open(MODELFILE_PATH, 'w', encoding='utf-8') as f:
                f.write(content)
            
            # Ollama 모델 재생성
            import subprocess
            result = subprocess.run(
                ['ollama', 'create', 'luna', '-f', MODELFILE_PATH],
                capture_output=True, text=True, timeout=60
            )
            
            if result.returncode == 0:
                print("  🎯 Modelfile 업데이트 + 모델 재생성 완료!")
                print("     루나의 두뇌가 축적된 지식과 함께 업그레이드되었습니다!")
                return True
            else:
                print(f"  ⚠️ 모델 재생성 실패: {result.stderr[:100]}")
                return False
            
        except Exception as e:
            print(f"  ⚠️ Modelfile 업데이트 실패: {str(e)[:80]}")
            return False
    
    def get_stats(self):
        """증류 시스템 상태"""
        core = self.knowledge_core
        filled = sum(1 for v in core["knowledge_categories"].values() if v)
        total = len(core["knowledge_categories"])
        return {
            "distill_count": core.get("distill_count", 0),
            "last_distilled": core.get("last_distilled"),
            "categories_filled": f"{filled}/{total}",
            "knowledge_size": len(core.get("condensed_prompt", ""))
        }


# === 자율 코드 창작 엔진 ===
class CodeCreationEngine:
    """
    루나가 새로운 Python 모듈을 직접 창작할 수 있는 엔진.
    안전 장치를 거쳐 PROJECT_ROOT 내에서만 작동.
    """
    
    def __init__(self):
        from luna_safety import safe_write_file, backup_file, is_path_safe
        self.safe_write = safe_write_file
        self.backup = backup_file
        self.is_path_safe = is_path_safe
    
    def create_module(self, filename, description, model="luna"):
        """AI에게 Python 모듈을 작성하게 함"""
        if not filename.endswith('.py'):
            filename += '.py'
        
        filepath = os.path.join(PROJECT_ROOT, filename)
        
        if not self.is_path_safe(filepath):
            return False, "안전하지 않은 경로"
        
        # 기존 파일이 있으면 백업
        if os.path.exists(filepath):
            self.backup(filepath)
        
        try:
            with httpx.Client() as client:
                res = client.post(OLLAMA_URL, json={
                    "model": model,
                    "prompt": f"""Python 모듈을 작성하세요.
파일명: {filename}
설명: {description}

규칙:
1. 순수 Python 코드만 작성 (마크다운 코드 블록 없이)
2. 맨 위에 docstring으로 설명 포함
3. 에러 처리 포함
4. if __name__ == "__main__": 블록으로 테스트 가능하게""",
                    "stream": False,
                    "options": {"temperature": 0.3, "num_predict": 2000}
                }, timeout=120)
                
                if res.status_code == 200:
                    code = res.json().get("response", "")
                    
                    # 마크다운 코드 블록 제거
                    import re
                    code_match = re.search(r'```python\s*(.*?)```', code, re.DOTALL)
                    if code_match:
                        code = code_match.group(1).strip()
                    else:
                        # ```없이 코드가 왔을 수도 있음
                        code = code.strip()
                    
                    # 구문 검증
                    import ast
                    try:
                        ast.parse(code)
                    except SyntaxError as e:
                        return False, f"생성된 코드에 구문 오류: {e.msg} (line {e.lineno})"
                    
                    # 안전 쓰기
                    success, msg = self.safe_write(filepath, code, actor="code_creation_engine")
                    if success:
                        return True, f"새 모듈 생성 완료: {filename}"
                    return False, msg
        
        except Exception as e:
            return False, f"코드 생성 오류: {str(e)[:80]}"
        
        return False, "코드 생성 실패"


if __name__ == "__main__":
    print("=== Luna Knowledge Distillation Engine ===")
    distiller = KnowledgeDistiller()
    
    stats = distiller.get_stats()
    print(f"  증류 횟수: {stats['distill_count']}")
    print(f"  채워진 카테고리: {stats['categories_filled']}")
    print(f"  지식 크기: {stats['knowledge_size']} chars")
    
    print("\n지식 증류 실행 중...")
    distiller.distill()
    
    print("\n완료!")
