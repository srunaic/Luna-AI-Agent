"""
Luna Body Controller v4.2 - Autonomous Stability Edition
========================================================
- Reversion: 수동 모션 기능을 제거하고 AI 자율 포즈/표정 시스템으로 복구
- TTS Cleanup: 특수문자 발화 방지 로직과 연동
- Stability: CORS 패치 및 레거시 API 호환성 유지
- Default: 항상 자연스러운 대기(Idle) 상태 유지
"""

import sys
import os
import time
import math
import random
import threading
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'luna-server'))

from pythonosc import udp_client
from flask import Flask, request, jsonify, make_response

# ============================================================
#  해부학적 제한 및 유틸리티
# ============================================================
def clamp(v, min_v, max_v):
    return max(min_v, min(v, max_v))

class Constraints:
    LIMITS = {
        'Neck':          (-0.5, 0.5, -0.8, 0.8, -0.4, 0.4),
        'Head':          (-0.4, 0.4, -1.0, 1.0, -0.5, 0.5),
        'Spine':         (-0.2, 0.3, -0.2, 0.2, -0.1, 0.1),
        'Chest':         (-0.1, 0.2, -0.1, 0.1, -0.05, 0.05),
        'LeftUpperArm':  (-0.5, 1.5, -0.8, 0.8, 0.1, 1.6),
        'RightUpperArm': (-0.5, 1.5, -0.8, 0.8, -1.6, -0.1),
        'LeftLowerArm':  (-0.1, 0.1, -0.2, 0.2, 0.0, 2.0),
        'RightLowerArm': (-0.1, 0.1, -0.2, 0.2, -2.0, 0.0),
        'Hips':          (-0.2, 0.2, -0.3, 0.3, -0.2, 0.2),
    }
    @staticmethod
    def apply(bone, rx, ry, rz):
        if bone in Constraints.LIMITS:
            limits = Constraints.LIMITS[bone]
            return (clamp(rx, limits[0], limits[1]), clamp(ry, limits[2], limits[3]), clamp(rz, limits[4], limits[5]))
        return rx, ry, rz

class OrganicNoise:
    def __init__(self, seed=0, strength=1.0):
        self.layers = []
        self.strength = strength
        r = random.Random(seed)
        for _ in range(4):
            self.layers.append({
                'freq': r.uniform(0.3, 1.5),
                'amp': r.uniform(0.2, 0.6),
                'phase': r.uniform(0, math.pi * 2),
            })
        total_amp = sum(l['amp'] for l in self.layers)
        for l in self.layers: l['amp'] /= total_amp

    def sample(self, t):
        val = sum(math.sin(t * l['freq'] + l['phase']) * l['amp'] for l in self.layers)
        return val * self.strength

# ============================================================
#  표정 및 포즈 뱅크 (Autonomous)
# ============================================================
IDLE_POSES = {
    "relaxed": {
        "desc": "기본 편안한 자세 (팔을 자연스럽게 내림)",
        "LeftUpperArm":  {"rz": 1.45, "rx": 0.0, "ry": 0.0},
        "RightUpperArm": {"rz": -1.45, "rx": 0.0, "ry": 0.0},
        "LeftLowerArm":  {"rz": 0.0, "rx": 0.05},
        "RightLowerArm": {"rz": 0.0, "rx": 0.05},
        "Spine":         {"rx": 0.01},
    },
    "thinking": {
        "RightUpperArm": {"rz": -0.45, "rx": 0.5},
        "RightLowerArm": {"rz": -1.1, "rx": 0.6},
        "Head": {"rz": 0.08, "rx": 0.05},
    },
    "hands_hip": {
        "LeftUpperArm":  {"rz": 0.85, "ry": 0.3, "rx": 0.2},
        "RightUpperArm": {"rz": -0.85, "ry": -0.3, "rx": 0.2},
    },
    "shy_look": {
        "Hips": {"ry": 0.12},
        "Head": {"rx": 0.12, "ry": -0.15},
    },
    "arms_crossed": {
        "LeftUpperArm":  {"rz": 0.9, "rx": 0.4, "ry": 0.3},
        "RightUpperArm": {"rz": -0.9, "rx": 0.4, "ry": -0.3},
    }
}

ADVANCED_EXPRESSIONS = {
    "neutral": {},
    "happy":    {"Joy": 1.0, "Fun": 0.5},
    "laugh":    {"Joy": 1.0, "Fun": 1.0},
    "sad":      {"Sorrow": 0.8},
    "angry":    {"Angry": 0.9},
    "surprise": {"Surprise": 1.0},
    "wink_l":   {"Blink_L": 1.0, "Joy": 0.3},
    "wink_r":   {"Blink_R": 1.0, "Joy": 0.3},
}

# ============================================================
#  메인 신체 컨트롤러 v4.2
# ============================================================
class LunaBody:
    def __init__(self, ip="127.0.0.1", port=39539):
        self.client = udp_client.SimpleUDPClient(ip, port)
        self.running = True
        
        # 상태 변수
        self.target_pose = dict(IDLE_POSES["relaxed"])
        self.pose_bank = dict(IDLE_POSES["relaxed"])
        self.pose_blend = 1.0
        self.current_pose_name = "relaxed"
        
        self.noise = { k: OrganicNoise(seed=i) for i, k in enumerate(['breath', 'sway_y', 'sway_z', 'h_x', 'h_y', 'h_z', 'la', 'ra']) }
        self.blink_timer = 0.0
        self.blink_next = 3.0
        
        print("Luna Body v4.2 Running: Fully Autonomous Mode")

    def _send_bone(self, bone, rx=0, ry=0, rz=0):
        rx, ry, rz = Constraints.apply(bone, rx, ry, rz)
        try: self.client.send_message("/VMC/Ext/Bone/Pos", [bone, 0.0, 0.0, 0.0, float(rx), float(ry), float(rz), 1.0])
        except: pass

    def set_pose(self, name):
        if name in IDLE_POSES:
            self.pose_bank = dict(self.target_pose)
            self.target_pose = IDLE_POSES[name]
            self.pose_blend = 0.0
            self.current_pose_name = name

    def set_emotion(self, name):
        if name not in ADVANCED_EXPRESSIONS: name = "neutral"
        for b in ["Joy", "Angry", "Sorrow", "Fun", "Surprise", "Blink_L", "Blink_R"]:
            try: self.client.send_message("/VMC/Ext/Blend/Val", [b, 0.0])
            except: pass
        emap = ADVANCED_EXPRESSIONS[name]
        for k, v in emap.items():
            try: self.client.send_message("/VMC/Ext/Blend/Val", [k, float(v)])
            except: pass
        try: self.client.send_message("/VMC/Ext/Blend/Apply", [])
        except: pass

    def run_forever(self):
        last_t = time.time()
        while self.running:
            t = time.time()
            dt = min(t - last_t, 0.1)
            last_t = t
            
            # 포즈 블렌딩 (부드러운 전환)
            if self.pose_blend < 1.0:
                self.pose_blend = min(1.0, self.pose_blend + dt * 0.8)
            
            # 노이즈 샘플링
            nv = {k: v.sample(t) for k, v in self.noise.items()}
            
            # 뼈대 업데이트
            bones = ["Hips", "Spine", "Chest", "Neck", "Head", "LeftUpperArm", "RightUpperArm", "LeftLowerArm", "RightLowerArm"]
            for b in bones:
                def get_p(ax):
                    p = self.pose_bank.get(b, {}).get(ax, 0)
                    tgt = self.target_pose.get(b, {}).get(ax, 0)
                    return p + (tgt - p) * self.pose_blend
                
                rx, ry, rz = get_p("rx"), get_p("ry"), get_p("rz")
                
                # 자율 노이즈 주입 (Organic Idle)
                if b == "Spine": rx += nv['breath'] * 0.015
                elif b == "Hips": ry += nv['sway_y'] * 0.02
                elif b == "Head": 
                    rx += nv['h_x'] * 0.03
                    ry += nv['h_y'] * 0.05
                
                self._send_bone(b, rx, ry, rz)
            
            # 눈 깜빡임
            self.blink_timer += dt
            if self.blink_timer >= self.blink_next:
                try: 
                    self.client.send_message("/VMC/Ext/Blend/Val", ["Blink", 1.0])
                    self.client.send_message("/VMC/Ext/Blend/Apply", [])
                    time.sleep(0.08)
                    self.client.send_message("/VMC/Ext/Blend/Val", ["Blink", 0.0])
                    self.client.send_message("/VMC/Ext/Blend/Apply", [])
                except: pass
                self.blink_timer = 0
                self.blink_next = random.uniform(2, 6)
                
            time.sleep(0.016)

# ============================================================
#  API Server
# ============================================================
app = Flask(__name__)
body = LunaBody()

@app.after_request
def add_cors(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return resp

@app.route('/command', methods=['POST', 'OPTIONS'])
def handle_cmd():
    if request.method == 'OPTIONS': return make_response()
    d = request.json or {}
    t = d.get('type')
    if t == 'pose': body.set_pose(d.get('name'))
    elif t == 'emotion': body.set_emotion(d.get('name'))
    return jsonify({'status': 'ok'})

# Legacy Aliases
@app.route('/pose', methods=['POST', 'OPTIONS'])
def handle_pose(): return handle_cmd()
@app.route('/emotion', methods=['POST', 'OPTIONS'])
def handle_emo(): return handle_cmd()
@app.route('/speak', methods=['POST', 'OPTIONS'])
def handle_speak(): return handle_cmd()

if __name__ == '__main__':
    threading.Thread(target=body.run_forever, daemon=True).start()
    app.run(host='127.0.0.1', port=6782, debug=False)
