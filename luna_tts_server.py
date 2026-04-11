"""
Luna TTS Server - XTTS v2 기반 음성 클로닝
별도 프로세스로 실행되며, Luna 서버가 HTTP로 호출합니다.
"""
import os
import sys
import torch
import io
import time
import traceback
from flask import Flask, request, send_file

# 자동 약관 동의 (XTTS v2)
os.environ['COQUI_TOS_AGREED'] = '1'

# --- [CRITICAL] Monkey Patch for Module-Level Imports in Coqui-TTS ---
import transformers.utils.import_utils as import_utils
if not hasattr(import_utils, 'is_torch_greater_or_equal'):
    from packaging.version import parse
    def is_torch_greater_or_equal(min_version):
        return parse(torch.__version__.split('+')[0]) >= parse(min_version)
    import_utils.is_torch_greater_or_equal = is_torch_greater_or_equal

if not hasattr(import_utils, 'is_torchcodec_available'):
    import_utils.is_torchcodec_available = lambda: False

import transformers.pytorch_utils as pytorch_utils
if not hasattr(pytorch_utils, 'isin_mps_friendly'):
    import torch
    pytorch_utils.isin_mps_friendly = torch.isin
# --------------------------------------------------------------------

from transformers import GenerationConfig

app = Flask(__name__)

# 참조 음성 파일 경로
REFERENCE_WAV = os.path.join(os.path.dirname(__file__), 'luna_ref.wav')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'luna-server', 'media')

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR, exist_ok=True)

# 전역 TTS 모델 (지연 로딩)
tts_model = None

def get_tts():
    global tts_model
    if tts_model is None:
        from TTS.api import TTS
        print("Restoring XTTS v2 Model with Direct Instance Injection...")
        device = "cuda" if torch.cuda.is_available() else "cpu"
        
        # RTX 4060의 성능을 위해 use_deepspeed=True(가능한 경우) 및 GPU 최적화 적용
        # 여기서는 기본적으로 GPU 로드 시 FP16 등을 고려하여 최적화 로드 시도
        tts_model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
        
        # GPU 메모리 효율 및 속도를 위한 캐시 정리
        if device == "cuda":
            torch.cuda.empty_cache()
            print("GPU acceleration enabled (CUDA).")
        
        # Aggressive Instance Patching (Bypass descriptors and validation)
        try:
            gpt_model = tts_model.synthesizer.tts_model.gpt
            
            # 1. Bypass validation logic
            gpt_model.can_generate = lambda: True
            
            # 2. Inject GenerationConfig (Bypassing potential property restrictions)
            gen_config = GenerationConfig()
            if hasattr(gpt_model, 'config') and gpt_model.config:
                try:
                    gen_config = GenerationConfig.from_model_config(gpt_model.config)
                except:
                    pass
            
            # Direct injection into __dict__ ensures it's found even if the property is broken
            gpt_model.__dict__['generation_config'] = gen_config
            gpt_model.__dict__['main_input_name'] = "input_ids"
            
            # 3. Suppress validation errors in call
            def _dummy_validate(*args, **kwargs): return
            gpt_model._validate_model_class = _dummy_validate
            gpt_model._validate_model_kwargs = _dummy_validate
            
            print("Successfully injected compatibility attributes into model instance.")
        except Exception as e:
            print(f"Warning: Failed to inject instance attributes: {e}")
            traceback.print_exc()

        print(f"XTTS v2 Loaded! (Device: {device})")
    return tts_model

@app.route('/health', methods=['GET'])
def health():
    device_info = str(next(tts_model.parameters()).device) if tts_model else "not_loaded"
    return {'status': 'ok', 'model_loaded': tts_model is not None, 'device': device_info}

@app.route('/synthesize', methods=['POST'])
def synthesize():
    try:
        data = request.json
        text = data.get('text', '')
        language = data.get('language', 'ko')
        
        if not text:
            return {'error': 'No text provided'}, 400
        
        if not os.path.exists(REFERENCE_WAV):
            return {'error': f'참조 음성 파일 없음: {REFERENCE_WAV}'}, 500
        
        tts = get_tts()
        output_filename = f"luna_voice_{int(time.time() * 1000)}.wav"
        output_path = os.path.join(OUTPUT_DIR, output_filename)
        
        print(f"Synthesizing: {text[:50]}...")
        tts.tts_to_file(
            text=text,
            speaker_wav=REFERENCE_WAV,
            language=language,
            file_path=output_path
        )
        
        return send_file(output_path, mimetype='audio/wav')
    except Exception as e:
        print("!!! Synthesis Error !!!")
        traceback.print_exc()
        return {'error': str(e)}, 500

if __name__ == '__main__':
    print("Starting Luna TTS Server...")
    try:
        get_tts()
    except:
        traceback.print_exc()
    
    print(f"Server running at http://127.0.0.1:6781")
    app.run(host='127.0.0.1', port=6781, debug=False)
