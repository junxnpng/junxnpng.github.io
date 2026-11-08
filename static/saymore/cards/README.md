# Say More 단어 카드

홈의 학습 메뉴 → **첫 100단어 · 카드 만들기와 복습**으로 들어갑니다. 맥 Chrome 또는 Edge에서 **폴더 연결**을 누르고 옵시디언 보관함을 선택하세요. 기존 `SayMore/카드` 폴더를 직접 선택해도 됩니다.

1. **카드 추가**에서 종류와 덱 이름을 정합니다.
2. 그림 → 단어는 사진과 정답, 앞면 → 뒷면은 질문 또는 사진과 정답을 넣습니다. IPA·MP3·예문·나의 기억·태그는 선택입니다.
3. **추가하고 다음 카드**로 계속 만들거나 **저장하고 목록 보기**로 확인합니다. ⌘Enter도 저장합니다.
4. **오늘 복습**에서 정답을 확인하고 다시·어려움·알맞음·쉬움 중 하나를 고릅니다. 다음 날짜와 전체 기록이 파일에 저장됩니다. Space는 정답, 숫자 1–4는 답변입니다.

## 저장되는 파일

```text
SayMore/카드/
  library.json          카드 내용 + 다음 복습 날짜 + FSRS 상태 + 전체 복습 이력
  library.backup.json   직전의 정상 저장본
  notes/<카드 ID>.md    옵시디언에서 읽는 카드·일정·최근 복습 기록
  media/<파일 ID>.*     사진과 MP3
```

브라우저에는 폴더 연결 정보만 보관합니다. 카드 데이터의 정본은 `library.json`입니다. 접근 권한이 유지되면 다음 방문 때 자동으로 읽습니다. 권한이 만료되면 **이전 폴더 연결** 또는 **폴더 연결**을 누르세요. Safari·모바일 등 폴더 저장을 지원하지 않는 환경에서는 저장 버튼을 사용할 수 없습니다.

카드 내용은 웹 화면에서 수정합니다. Markdown의 생성 영역을 직접 수정한 내용은 웹으로 가져오지 않습니다. 생성 영역 바깥의 **추가 메모**는 보존합니다. 파일명은 단어를 바꿔도 같은 노트를 유지하도록 고유 ID를 사용합니다. 옵시디언에서는 노트 제목·본문의 단어로 찾을 수 있습니다.

카드·복습 기록이 저장된 뒤 Markdown 내보내기만 실패하면 이를 구분해 알리고 **옵시디언 노트 다시 저장**으로 복구할 수 있습니다. 이 동작은 복습 횟수를 늘리지 않습니다. 기본 저장 파일이 손상되면 덮어쓰지 않고 중단합니다. 복구 시 원본을 별도로 보관하고 `library.backup.json`을 확인하세요. 직전 저장본은 장기 백업을 대체하지 않습니다.

사진과 음성은 UUID 이름으로 보관하며 기존 첨부파일을 덮어쓰거나 자동 삭제하지 않습니다. 여러 탭의 쓰기는 Web Locks와 exclusive writer로 직렬화합니다. 파일이 외부에서 바뀌면 저장을 거절하므로 **저장된 내용 다시 읽기** 후 다시 시도합니다. 별도 브라우저나 외부 앱에서 같은 `library.json`을 동시에 편집하지 않습니다.

## 학습 방식

ts-fsrs **5.4.2**, **FSRS-6**, desired retention **0.9**, fuzz off, 기본 학습 단계 1분·10분을 사용합니다. 선택한 평가는 카드별 간격을 바꿉니다. 카드 수정·미리 보기는 복습 기록을 바꾸지 않습니다. 이 단어장은 Anki/AnkiWeb과 별개이며 기존 Anki 덱을 가져오거나 동기화하지 않습니다. 예전 coffee 예시는 별도의 폴더와 간격을 그대로 유지합니다.

소스는 `model.mjs`(검증·일정·노트), `storage.mjs`(로컬 파일·백업·권한), `view.mjs`(카드 표시), `app.mjs`(입력·목록·복습)로 나뉩니다. 브라우저에서 외부 실행 코드를 가져오지 않고 `vendor`의 고정 버전을 사용합니다. 사용자 데이터는 네트워크로 전송하지 않습니다.

## 출처와 라이선스

- 인터페이스 참고: [Anki Adding/Editing](https://docs.ankiweb.net/manual/editing), [Studying](https://docs.ankiweb.net/manual/studying).
- 복습: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), MIT. 원본 라이선스는 `vendor/ts-fsrs.LICENSE`에 있습니다.
- 예시 사진: [A small cup of coffee](https://commons.wikimedia.org/wiki/File:A_small_cup_of_coffee.JPG), Julius Schorzman, [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/), 원본 그대로.
- 예시 음성: [En-us-coffee](https://commons.wikimedia.org/wiki/File:En-us-coffee.ogg), Dvortygirl, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), Wikimedia의 MP3 변환본.
- 예시 IPA: [Wiktionary coffee](https://en.wiktionary.org/wiki/coffee#Pronunciation)의 /ˈkɑfi/ 음성에 사이트의 장음 표기를 적용한 /ˈkɑː.fi/. 미국식 /ɔ/도 사용됩니다.

## 검증

저장소 루트에서 실행합니다. Python은 Playwright와 Chromium이 설치된 환경을 사용합니다.

```sh
node --test tests/cards-model.test.mjs
python3 -m http.server 6390 --bind 127.0.0.1 --directory static
# 다른 터미널
python3 tests/cards_storage.py http://127.0.0.1:6390
python3 tests/cards_browser.py http://127.0.0.1:6390 /tmp/saymore-cards-qa
sh scripts/check
```

저장 검사는 실제 Chromium 파일 핸들을 사용하지만 선택기는 격리된 OPFS 폴더로 대체합니다. 사용자의 실제 보관함과 macOS 폴더 선택 창은 자동 테스트가 만지지 않습니다.
