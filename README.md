# junxnpng.github.io

Say More — Fluent Forever의 발음 우선 학습에서 영감을 받은 개인 영어 회화 연습실. Hugo + [PaperMod](https://github.com/adityatelange/hugo-PaperMod)(MIT).

## 구조

- `/` — Say More 메인. 학습 메뉴에서 IPA와 단어 카드로 진입한다. 화면은 `layouts/home.html`.
- `/saymore/ipa/` — 미국식 IPA 발음 가이드. 기존 주소를 유지한다.
- `/saymore/card-demo/` — 사진·발음·예문으로 연습하고 옵시디언 폴더에 저장하는 coffee 카드 예시. 소스와 사용법은 `examples/coffee-card/`.
- `/saymore/cards/` — 여러 카드 추가·수정·미리 보기·FSRS 복습. 카드와 일정은 선택한 옵시디언 보관함의 `SayMore/카드`에 저장한다. 사용법·저장 형식·검증은 `static/saymore/cards/README.md`.
- `/saymore/` — 메인 `/`으로 연결하는 이전 주소.
- `content/saymore/` — 공개 콘텐츠. Hugo에서 콘텐츠 루트로 사용한다.
- `data/saymore/ipa.json` · `layouts/saymore/` · `assets/css/saymore.css` — 발음 설명 데이터, 가이드 화면, 스타일.
- `static/saymore/` — 공개 이미지와 출처. 프로젝트의 다른 정적 파일은 공개 대상에서 제외한다.

## 보관 자료

다음 기존 자료와 가져오기 도구는 저장소에 보관하지만, 현재 공개 사이트에는 포함하지 않는다.

- `content/notes/` — 논문 노트. **여기서 쓰지 않는다.** `athena-papers` 의 `scripts/export` 가 검증을 통과한 노트만 써 넣는다.
- `assets/catalog/catalog.fragment.html` — 논문 카탈로그 조각. 같은 방식으로 내보내지고 `layouts/papers/list.html` 이 감싼다(테마 헤더·다크 모드 포함).
- `content/posts/` — 논문이 아닌 글. 여기서 쓴다.
- `content/about.md` `cv.md` `archives.md` `search.md` — 이전 소개·이력·검색 페이지.
- `data/publications.yaml` — 논문 목록 정본. `/publications/` 가 연도별로 렌더링. CV PDF 는 `static/cv/`.
- `layouts/` — mermaid 렌더 훅과 로더, KaTeX(글마다 `math: true`).
- `content/study/` · `data/study/basic_verbs.json` — 영어 학습 목차와 14일 과정. 원본은 Obsidian의 `998_eng/basic_verbs/`이며 아래 명령으로 가져온다.
- `assets/css/extended/korean.css` — 한국어 본문 줄바꿈(keep-all).

## 로컬
```
hugo server -D
sh scripts/check     # 빌드 통과 + 공개 금지 패턴 검사
```

## 배포
GitHub Pages(사용자 사이트). main 푸시 → `.github/workflows/hugo.yml` 이 빌드·배포. 주소 https://junxnpng.github.io/ .
검사기는 사설 IP·전화번호·주민번호 패턴을 거부한다 — 이력에 연락처를 넣지 않는다.

## 영어 학습 자료 반영

메인 `/`의 학습 메뉴에서 `/saymore/ipa/`로 들어가 미국식 IPA의 조음 설명과 구강 구조 그림을 볼 수 있다. 번호는 `eng_ipa` 음성 목록과 대응하며 MP3 파일은 사이트에 포함하지 않는다. 그림 출처와 개별 라이선스는 `static/saymore/images/sources.json` 및 페이지 하단에 기록한다.

모음 비교에는 Wright·McCloy의 원본 혀 윤곽(CC0)을 같은 방향과 축척으로 나란히 배치한다. 그림에 붙인 부위 번호는 입 안 구조도의 범례를 따른다. 자음 그림은 Tavin·Nardog의 단면도(CC BY-SA 4.0)를 사용한다. 그림을 수정할 때 원본 출처·변경 사항·라이선스를 유지한다. 카드의 기호와 개인 음원 번호를 보존하고, 위첨자 등 화면용 표기가 필요하면 `display_symbol`에 별도로 적는다.

`#vowel-chart`에는 Iowa State University의 공개 교재에 실린 General American 단모음·이중모음 차트(CC BY-SA 4.0)를 싣는다. 원도는 Mr KEBAB·Moxfyre·Angr, 단모음 방향 이름은 Abbey Elder의 편집이다. 교재의 이미지를 추가 수정 없이 보관하며 출처와 해시는 `static/saymore/images/sources.json`에 기록한다. 차트의 ɛ/e와 이 페이지의 /e/eɪ/를 혼동하지 않도록 대응표를 제공하고, 링크는 기존 발음 항목을 연다. 차트는 대표 위치의 참고도이며 실제 혀의 해부학적 좌표나 모든 미국 화자의 발음을 뜻하지 않는다.

`/study/basic-verbs/`는 하루 20–21개 뜻을 카드로 보여준다. 예문 펼치기, 티어·검색 필터, 미완료 복습과 날짜별 진행률을 제공한다. 완료 기록은 브라우저 `localStorage`에 항목별로 저장되며 기기 간 동기화하지 않는다. 같은 브라우저의 다른 탭과 뒤로가기로 복원된 페이지는 최신 기록을 다시 읽는다. 이전 버전의 완료 기록도 유지한다. 사이트와 저장소의 학습 자료는 공개된다.

원본 Markdown을 수정한 뒤 저장소 루트에서 실행한다. 생성된 `content/study/`와 `data/study/`는 직접 수정하지 않는다.

```sh
python3 scripts/import-study.py "/Users/jun/Documents/Jun's box/998_eng/basic_verbs"
python3 -m unittest discover -s tests -v
sh scripts/check
```

다른 원본 폴더를 사용할 때는 첫 번째 명령에 해당 경로를 전달한다. 가져오기는 원본 파일을 수정하지 않고 고정 ID·원래 순서·예문 작성/인용 표시·사용역·출처·티어 판단 근거를 유지한다. 구동사·관용표현은 이 과정에 포함되지 않는다. 변경을 검토하고 `main`에 push하면 사이트에 반영된다.

브라우저 기능 검증은 Playwright와 Chromium이 설치된 Python 환경에서 Hugo 서버를 실행한 뒤 수행한다.

```sh
hugo server --disableFastRender
# 다른 터미널에서
python3 tests/study_browser.py http://127.0.0.1:1313
python3 tests/study_persistence.py http://127.0.0.1:1313
```

## Dropbox 학습 기록

IPA의 외운 상태와 단어장 카드·첨부파일·FSRS 전체 복습 기록은 같은 Dropbox 앱 연결을 사용한다. 각 브라우저에서 같은 계정을 한 번 연결한다. 앱은 App folder 범위이며 공개 식별자만 `static/saymore/sync-config.json`에 둔다. 앱 비밀은 사용하지 않고 OAuth PKCE로 연결한다. 브라우저의 지속 연결 정보는 해당 기기의 localStorage에만 저장되며 Git·백업 내보내기에는 포함하지 않는다.

- `/ipa-progress.json`: 항목 ID별 외운 상태·변경 시각. 읽은 Dropbox revision으로만 갱신하고 충돌 시 다시 읽어 합친다. 체크 해제도 기록하여 과거 백업이 외운 상태를 되살리지 않게 한다.
- `/cards/library.json`: 카드 정본. 카드 ID·스케줄·복습 이력을 유지한다. 서로 다른 카드의 변경은 합치며 같은 카드에 동시 변경이 생기면 저장을 중단하고 입력을 화면에 남긴다. 첨부파일을 먼저 올리고 정본을 마지막에 갱신한다.
- `/cards/media`, `/cards/notes`, `/cards/backups`: 비공개 첨부파일, 읽기용 노트, 수정 전 정본. 기존 폴더 가져오기는 파일을 다시 내려받아 원본과 비교하고 원본을 삭제하지 않는다.

웹페이지는 다시 열기·화면 복귀·30초 간격으로 변경을 확인한다. 단어장 저장은 온라인에서 수행하며 저장 실패 시 입력을 유지한다. IPA 체크는 먼저 브라우저에 저장하고 연결이 복구되면 합친다. ‘외웠어요’ 표시와 FSRS 복습 상태는 별개다.

IPA 기록의 Obsidian 자동 반영은 맥에서 `scripts/ipa-obsidian-sync.py`를 사용한다. `--authorize /path/to/vault`로 읽기 전용 Dropbox 연결을 완료한 뒤 `--install`로 로그인 후 1분 간격 실행을 등록한다. `--sync`는 한 번 실행한다. 연결 정보는 macOS 키체인, 보관함 경로는 사용자 Application Support에 저장하며 공개 저장소와 보관함에 인증 정보를 넣지 않는다. `SayMore/IPA 학습기록.md`의 생성 영역만 갱신하고 추가 메모는 유지한다. 맥이 꺼진 동안에도 웹의 Dropbox 저장은 계속 가능하며 노트는 맥이 켜지면 갱신된다.

검사: `node --test tests/cards-model.test.mjs tests/cards-dropbox.test.mjs tests/dropbox.test.mjs tests/ipa_progress.test.cjs`, `python3 -m unittest discover -s tests -p test_ipa_obsidian.py`, `sh scripts/check`.

폴더 선택을 사용할 수 없는 환경에서는 단어장의 ‘카드 백업으로 가져오기’를 사용한다. `saymore-card-bundle` version 1은 상대 경로·파일 종류·base64 내용·SHA-256을 묶으며, 모든 파일의 내용을 검증한 뒤 기존 폴더 가져오기와 같은 절차로 이전한다. 인증 정보는 이 묶음에 포함하지 않는다.
