# junxnpng.github.io

Say More — Fluent Forever의 발음 우선 학습에서 영감을 받은 개인 영어 회화 연습실. Hugo + [PaperMod](https://github.com/adityatelange/hugo-PaperMod)(MIT).

## 구조

- `/` — Say More 메인. 학습 메뉴에서 IPA로 진입한다. 화면은 `layouts/home.html`.
- `/saymore/ipa/` — 미국식 IPA 발음 가이드. 기존 주소를 유지한다.
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

모음 그림은 Wright·McCloy의 원본 혀 윤곽 두 개를 겹친 비교도(CC0)이며, 자음 그림은 Tavin·Nardog의 단면도를 편집한 자료(CC BY-SA 4.0)다. 유성·무성 쌍은 같은 입 위치를 공유할 수 있으므로 성대 표시와 설명을 함께 제공한다. 그림을 수정할 때 원본 출처·변경 사항·라이선스를 유지한다.

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
