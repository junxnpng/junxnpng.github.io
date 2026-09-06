# junxnpng.github.io

개인 사이트. Hugo + [PaperMod](https://github.com/adityatelange/hugo-PaperMod)(MIT). 뼈대는 영어, 논문 노트 본문은 한국어 요약.

## 구조
- `content/notes/` — 논문 노트. **여기서 쓰지 않는다.** `athena-papers` 의 `scripts/export` 가 검증을 통과한 노트만 써 넣는다.
- `assets/catalog/catalog.fragment.html` — 논문 카탈로그 조각. 같은 방식으로 내보내지고 `layouts/papers/list.html` 이 감싼다(테마 헤더·다크 모드 포함).
- `content/posts/` — 논문이 아닌 글. 여기서 쓴다.
- `content/about.md` `cv.md` `archives.md` `search.md` — 뼈대 페이지(영어). 홈은 Home-Info 모드(소개 + 최신 글).
- `data/publications.yaml` — 논문 목록 정본. `/publications/` 가 연도별로 렌더링. CV PDF 는 `static/cv/`.
- `layouts/` — mermaid 렌더 훅과 로더, KaTeX(글마다 `math: true`).
- `assets/css/extended/korean.css` — 한국어 본문 줄바꿈(keep-all).

## 로컬
```
hugo server -D
sh scripts/check     # 빌드 통과 + 공개 금지 패턴 검사
```

## 배포
GitHub Pages(사용자 사이트). main 푸시 → `.github/workflows/hugo.yml` 이 빌드·배포. 주소 https://junxnpng.github.io/ .
검사기는 사설 IP·전화번호·주민번호 패턴을 거부한다 — 이력에 연락처를 넣지 않는다.
