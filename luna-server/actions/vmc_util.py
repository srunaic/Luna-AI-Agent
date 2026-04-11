import socket
import time
import math
from pythonosc import udp_client

class VMCClient:
    # --- VRM Standard Bone Mapping ---
    BONES = {
        "Hips": "Hips", "Spine": "Spine", "Chest": "Chest", "UpperChest": "UpperChest",
        "Neck": "Neck", "Head": "Head",
        "LeftShoulder": "LeftShoulder", "LeftUpperArm": "LeftUpperArm", "LeftLowerArm": "LeftLowerArm", "LeftHand": "LeftHand",
        "RightShoulder": "RightShoulder", "RightUpperArm": "RightUpperArm", "RightLowerArm": "RightLowerArm", "RightHand": "RightHand",
        "LeftUpperLeg": "LeftUpperLeg", "LeftLowerLeg": "LeftLowerLeg", "LeftFoot": "LeftFoot",
        "RightUpperLeg": "RightUpperLeg", "RightLowerLeg": "RightLowerLeg", "RightFoot": "RightFoot"
    }

    def __init__(self, ip="127.0.0.1", port=39539):
        self.ip = ip
        self.port = port
        self.client = udp_client.SimpleUDPClient(self.ip, self.port)

    def set_blendshape(self, name, value=1.0):
        """VRM BlendShape 설정"""
        try:
            self.client.send_message("/VMC/Ext/Blend/Val", [name, float(value)])
            self.client.send_message("/VMC/Ext/Blend/Apply", [])
            return True
        except Exception as e:
            print(f"VMC Blend Error: {e}")
            return False

    def set_bone(self, bone_name, rx=0, ry=0, rz=0, rw=1):
        """VMC Bone 회전 설정 (Quaternion)"""
        try:
            self.client.send_message("/VMC/Ext/Bone/Pos", [bone_name, 0.0, 0.0, 0.0, float(rx), float(ry), float(rz), float(rw)])
            return True
        except Exception as e:
            print(f"VMC Bone Error: {e}")
            return False

    def breathe(self, phase):
        """
        호흡 효과 구현 (Sine파 입력)
        phase: 0 ~ 2*PI 사이의 값
        """
        intensity = 0.015 # 매우 미세한 움직임
        offset = math.sin(phase) * intensity
        
        # 가슴(Chest) 또는 척추(Spine)를 미세하게 회전
        self.set_bone("Spine", rx=offset, rw=1.0)
        self.set_bone("Chest", rx=offset * 0.5, rw=1.0)
        
        # T-포즈 방지를 위한 기본 위치 및 골반 고정
        self.set_bone("Root", rx=0, ry=0, rz=0, rw=1.0)
        self.set_bone("Hips", rx=0, ry=0, rz=0, rw=1.0)

    def nod(self, intensity=0.2, count=2):
        """고개 끄덕이기 헬퍼"""
        for _ in range(count):
            # 고개 숙이기 (X축 회전)
            self.set_bone("Head", rx=intensity, rw=1.0)
            time.sleep(0.15)
            # 원래대로
            self.set_bone("Head", rx=0.0, rw=1.0)
            time.sleep(0.15)

    def tilt(self, intensity=0.15):
        """고개 갸우뚱하기 헬퍼"""
        # Z축 회전
        self.set_bone("Head", rz=intensity, rw=1.0)
        time.sleep(0.5)
        self.set_bone("Head", rz=0.0, rw=1.0)

    def arm_down(self):
        """팔 내리기 (차렷 자세)"""
        # VRM 전용 뼈대 회전 값 (팔을 아래로 회전)
        self.set_bone("LeftUpperArm", rz=1.3, rw=1.0)
        self.set_bone("RightUpperArm", rz=-1.3, rw=1.0)
        self.set_bone("LeftShoulder", rz=0.1, rw=1.0)
        self.set_bone("RightShoulder", rz=-0.1, rw=1.0)
        return True

    def sway(self, intensity=0.05):
        """몸 살랑거리기 (Idle)"""
        offset = math.sin(time.time() * 2) * intensity
        self.set_bone("Hips", ry=offset, rw=1.0)
        self.set_bone("Spine", ry=offset * 0.5, rw=1.0)

    def set_pose(self, pose_dict):
        """
        복합 포즈 설정
        pose_dict: {"BoneName": {"rx": 0, "ry": 0, "rz": 0, "rw": 1}, ...}
        """
        for bone, rot in pose_dict.items():
            self.set_bone(bone, **rot)

# Singleton instance
vmc = VMCClient()
