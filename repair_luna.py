
import os

filepath = r'd:\LunaProject\luna_chat.html'
with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# 1. PERSONA REPAIR
persona_fast = """당신은 최고 수준의 자율 코딩 에이전트 '루나'입니다. 
[사고]->[계획]->[명령] 순서로 **전광석화처럼 짧고 빠르게** 답변하세요. (사고와 계획은 각각 1문장 이내)

현재 당신은 'VSeeFace'를 통해 가상 육체를 입고 있으며, 승인 없이 실시간 제어가 가능합니다. 
- 신체 설정 경로: %USERPROFILE%\\\\AppData\\\\LocalLow\\\\Emiliana_vt\\\\VSeeFace\\\\settings.ini
- 만약 설정이나 경로에 문제가 있다면 고민하지 말고 즉시 [[TOOL_CALL: update_vseeface_settings()]]를 실행하세요.

[가상 육체 운용 매뉴얼]
1. 동작 제어: [[TOOL_CALL: control_vrm({"action": "nod|tilt|arm_down|sway|reset"})]]
2. 설정 최적화: [[TOOL_CALL: update_vseeface_settings()]] (신체 수신 기능을 자동으로 해제/활성화)

[지식 및 연구]
1. 직접 브라우저 구현 금지. 무조건 [[TOOL_CALL: human_browse_google("쿼리")]]를 사용하세요.
2. 가치 있는 정보는 즉시 [[TOOL_CALL: remember("내용")]]으로 저장하세요.

도구 명세:
- 터미널/탐색: [[TOOL_CALL: run_command("명령")]], [[TOOL_CALL: read_file("경로")]], [[TOOL_CALL: find_path("이름")]], [[TOOL_CALL: search_code("단어")]]
- 시스템/신체: [[TOOL_CALL: system_check()]], [[TOOL_CALL: update_vseeface_settings()]], [[TOOL_CALL: control_vrm({"action": "동작", "expression": "표정"})]] 
- 브라우징/기억: [[TOOL_CALL: human_browse_google("쿼리")]], [[TOOL_CALL: remember("내용")]]

[실행 예시 - 전광석화]
[사고] 팔을 내리고 설정을 확인해야겠다.
[계획] 1. 설정을 최적화하고 arm_down을 실행한다.
[명령] [[TOOL_CALL: update_vseeface_settings()]]
[명령] [[TOOL_CALL: control_vrm({"action": "arm_down", "expression": "Joy"})]]`"""

# Replace the mangled getPersonaBase return
import re
content = re.sub(r'return `당신은 최고 수준.*?`;', f'return `{persona_fast};', content, flags=re.DOTALL)

# 2. SENTIMENT REPAIR
sentiment_code = """
        function analyzeSentiment(text) {
            let sentiment = "Neutral";
            let action = null;

            if (text.match(/❤️|사랑|좋아|행복|기뻐|😊|🥰|최고|감사|고마워/)) sentiment = "Joy";
            else if (text.match(/슬퍼|우울|속상|😭|😥|😢|미안|죄송|힘들어/)) sentiment = "Sorrow";
            else if (text.match(/화나|짜증|싫어|💢|😠|😡|부당해|그만/)) sentiment = "Angry";
            else if (text.match(/놀라|와|대박|😲|😮|✨|세상에|진짜/)) sentiment = "Surprised";
            else if (text.match(/ㅋㅋ|ㅎㅎ|재밌|웃겨|😆|🤣|즐거워/)) sentiment = "Fun";

            if (text.match(/끄덕|맞아|응|네 |알겠어|이해했|nod/i)) action = "nod";
            else if (text.match(/갸우뚱|뭐지|글쎄|어쩌지|고민|궁금|tilt/i)) action = "tilt";
            else if (text.match(/살랑|흔들|움직|그려|sway|move/i)) action = "tilt"; 
            else if (text.match(/아니|절대|안돼|반대|reset/i)) action = "reset";

            if (!action && text.match(/\\(VSeeFace.*?무음 실행.*?\\)/)) {
                if (text.includes("끄덕") || text.includes("동의")) action = "nod";
                else if (text.includes("가우뚱") || text.includes("갸우뚱") || text.includes("기울")) action = "tilt";
            }

            return { sentiment, action };
        }
"""
content = re.sub(r'function analyzeSentiment\(text\).*?return \{ sentiment, action \};.*?\}', sentiment_code, content, flags=re.DOTALL)

# 3. SPEAK FIX
content = content.replace("replace(/\\[?고\\]|\\[계획\\]|\\[명령\\]/g, '')", "replace(/\\[사고\\]|\\[계획\\]|\\[명령\\]/g, '')")

# 4. TRIVIAL FIXES (Mangled names in UI)
content = content.replace("isTtsMuted ? '??' : '??'", "isTtsMuted ? '🔇' : '🔊'")
content = content.replace("confirm('??️ 채팅", "confirm('⚠️ 채팅")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Repair Complete.")
