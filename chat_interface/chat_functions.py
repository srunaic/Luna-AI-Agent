# 이미지 업로드 기능 추가
def handle_image(image_data):
    print("이미지를 받았어요!")
    # 이미지 저장 및 처리 로직 넣기
    # 예시: image_data.save('received_image.jpg')

# 이미지 전송 함수 호출
chat_interface.register_command('send_image', handle_image)