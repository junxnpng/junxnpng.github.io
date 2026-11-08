# Coffee 카드 예시

`/saymore/card-demo/`에서 사진 → 답 확인 → 음성 듣기 → 복습 기록의 흐름을 체험합니다. 폴더를 연결하기 전에는 변경 내용이 현재 탭에만 남습니다.

## 맥에 저장

Chrome 또는 Edge에서 **옵시디언 폴더 연결**을 누르고 보관함을 선택합니다. 비어 있지 않은 보관함에서는 `SayMore/coffee-예시/`를 사용합니다. 기존 예시 폴더나 새 빈 폴더를 직접 선택할 수도 있습니다. 새 폴더에서는 **변경 내용 저장**을 눌러 초기 파일을 만듭니다.

- `coffee.md`: 옵시디언에서 읽는 카드와 첨부파일 링크
- `saymore-coffee.json`: 웹 화면에서 편집하는 카드 내용
- `review-state.json`: 복습 결과와 다음 날짜
- `media/`: 사진과 MP3

웹 화면에서 저장할 때 `coffee.md`의 생성 영역만 갱신하며, 아래 **추가 메모**는 보존합니다. 생성 영역을 옵시디언에서 직접 편집한 내용은 웹 화면으로 가져오지 않습니다. 카드의 예문·기억·사진·음성은 웹 화면에서 수정합니다. 다시 방문하면 폴더를 다시 선택합니다. 선택한 파일을 서버에 전송하지 않습니다.

예시의 복습 간격은 10분·1일·3일로 고정되어 있습니다. Anki나 FSRS의 학습 일정 계산을 구현한 제품은 아닙니다. 저장 중 실패에 대비한 여러 파일의 일괄 복구와 동시 편집 잠금도 제공하지 않습니다. 다른 창에서 JSON 파일이 변경되었으면 저장을 중단합니다.

## 다시 만들기

다음 원본을 `coffee.jpg`, `coffee.mp3`로 미디어 폴더에 준비합니다.

- [사진](https://commons.wikimedia.org/wiki/File:A_small_cup_of_coffee.JPG): Julius Schorzman, [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/). 원본 그대로 사용합니다.
  - 다운로드: `https://upload.wikimedia.org/wikipedia/commons/4/45/A_small_cup_of_coffee.JPG`
- [음성](https://commons.wikimedia.org/wiki/File:En-us-coffee.ogg): Dvortygirl, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Wikimedia의 MP3 변환본입니다.
  - 다운로드: `https://upload.wikimedia.org/wikipedia/commons/transcoded/e/e3/En-us-coffee.ogg/En-us-coffee.ogg.mp3`
- [발음 참고](https://en.wiktionary.org/wiki/coffee#Pronunciation): 이 음성에 연결된 미국식 /ˈkɑfi/를 사이트의 장음 표기 관례에 맞춰 /ˈkɑː.fi/로 표시합니다. 미국 화자의 모음 체계에 따라 /ɔ/를 쓰는 발음도 있습니다.

```sh
python3 examples/coffee-card/build.py --media /path/to/media --output static/saymore/card-demo/index.html
```

새 보관함 예시를 만들 때만 `--vault-example /path/to/new-example`을 추가합니다. 이미 존재하는 폴더는 덮어쓰지 않습니다. 출력 HTML에는 사진·음성·코드가 모두 포함됩니다.

## 확인

```sh
python3 -m http.server 6388 --bind 127.0.0.1 --directory static/saymore/card-demo
# 별도 터미널, Playwright와 Chromium을 설치한 Python 환경
python3 examples/coffee-card/check.py http://127.0.0.1:6388/ --screenshots /tmp/coffee-check
```

브라우저 검사는 답 표시, MP3 재생, 1280/390/320px 레이아웃, 폴더 저장·재불러오기, 복습 기록, 추가 메모 보존, 동시 변경 감지를 확인합니다. 폴더 선택기는 테스트용 브라우저 내부 폴더로 대체하므로 실제 macOS 폴더 선택 창과 권한 승인은 자동 검사 범위에 포함하지 않습니다.
