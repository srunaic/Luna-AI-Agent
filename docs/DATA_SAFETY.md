## Google Play Data Safety (초안)

이 문서는 Google Play Console의 “Data safety(데이터 보안)” 섹션 작성용 초안입니다.  
실제 앱 동작(수집/전송 여부)에 따라 체크 항목을 최종 확정해야 합니다.

### 1) 수집될 수 있는 데이터 유형(예시)
- **Personal info**
  - Name: 닉네임(선택)
  - User IDs: username/uid(서비스 내부 식별자)
- **Messages**
  - 채팅 메시지/댓글/콘텐츠(사용자 입력)
- **Device or other IDs**
  - (필요 시) user agent 등 최소 메타데이터
- **App activity**
  - 채널 참여/초대/강퇴/차단 이벤트(기능 제공 목적)

### 2) 데이터 수집 목적(예시)
- App functionality (핵심 기능 제공)
- Security & fraud prevention (악용 방지/보안)
- Communications (사용자 동의 시 푸시 알림)

### 3) 데이터 처리 방식(예시)
- **Encrypted in transit**: HTTPS/TLS 사용
- **Deletion requests**: 운영자 이메일을 통해 삭제 요청 처리(Privacy Policy 참고)

### 4) 제3자 공유(예시)
- 인프라 제공자(Supabase/Cloudflare) 범위에서만 처리(“공유”가 아니라 “처리위탁” 성격)

## Google Play Data Safety (초안)

이 문서는 Google Play Console의 “Data safety(데이터 보안)” 섹션 작성용 초안입니다.  
실제 앱 동작(수집/전송 여부)에 따라 체크 항목을 최종 확정해야 합니다.

### 1) 수집될 수 있는 데이터 유형(예시)
- **Personal info**
  - Name: 닉네임(선택)
  - User IDs: username/uid(서비스 내부 식별자)
- **Messages**
  - 채팅 메시지/댓글/콘텐츠(사용자 입력)
- **Device or other IDs**
  - (필요 시) user agent 등 최소 메타데이터
- **App activity**
  - 채널 참여/초대/강퇴/차단 이벤트(기능 제공 목적)

### 2) 데이터 수집 목적(예시)
- App functionality (핵심 기능 제공)
- Security & fraud prevention (악용 방지/보안)
- Communications (사용자 동의 시 푸시 알림)

### 3) 데이터 처리 방식(예시)
- **Encrypted in transit**: HTTPS/TLS 사용
- **Deletion requests**: 운영자 이메일을 통해 삭제 요청 처리(Privacy Policy 참고)

### 4) 제3자 공유(예시)
- 인프라 제공자(Supabase/Cloudflare) 범위에서만 처리(“공유”가 아니라 “처리위탁” 성격)


