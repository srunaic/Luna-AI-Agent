import sys
import types
import importlib

# -------------------------------------------------------------------------
# vLLM Windows uvloop Error Fix Launcher
# -------------------------------------------------------------------------
# uvloop는 윈도우를 지원하지 않아 vLLM 실행 시 ModuleNotFoundError가 발생합니다.
# 이 스크립트는 winloop를 사용하여 uvloop를 대체하거나, 
# 없을 경우 더미 모듈을 생성하여 임포트 단계를 통과시킵니다.
# -------------------------------------------------------------------------

def patch_uvloop():
    try:
        import winloop
        sys.modules['uvloop'] = winloop
        print("⚡ [LUNA] winloop이 감지되었습니다! vLLM이 윈도우 최적화 루프로 실행됩니다.")
    except ImportError:
        # winloop도 없는 경우, 최소한의 더미 모듈을 생성하여 에러만 피합니다.
        dummy_uvloop = types.ModuleType('uvloop')
        dummy_uvloop.install = lambda: None
        sys.modules['uvloop'] = dummy_uvloop
        print("⚠️  [LUNA] winloop을 찾을 수 없습니다. 기본 asyncio 루프를 사용합니다.")
        print("💡 TIP: 'pip install winloop'을 실행하면 윈도우에서 더 나은 성능을 얻을 수 있습니다.")

if __name__ == "__main__":
    patch_uvloop()
    
    try:
        # vLLM의 OpenAI API 서버 엔트리포인트를 로드합니다.
        from vllm.entrypoints.openai.api_server import main
        print("🚀 [LUNA] vLLM 서버를 시작합니다...")
        main()
    except ImportError as e:
        print(f"❌ [LUNA] vLLM을 불러오는 중 오류 발생: {e}")
        print("vLLM이 올바르게 설치되어 있는지 확인해 주세요.")
    except Exception as e:
        print(f"❌ [LUNA] 실행 중 예기치 않은 오류 발생: {e}")
