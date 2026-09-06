# athena-web

개인 사이트. Hugo + [PaperMod](https://github.com/adityatelange/hugo-PaperMod)(MIT). 뼈대는 영어, 논문 노트 본문은 한국어 요약.

## 구조
- `content/notes/` — 논문 노트. **여기서 쓰지 않는다.** `athena-papers` 의 `scripts/export` 가 검증을 통과한 노트만 써 넣는다.
- `static/papers/index.html` — 논문 카탈로그. 같은 방식으로 내보내진다.
- `content/posts/` — 논문이 아닌 글. 여기서 쓴다.
- `content/about.md` `archives.md` `search.md` — 뼈대 페이지(영어).
- `layouts/` — mermaid 렌더 훅과 로더, KaTeX(글마다 `math: true`).
- `assets/css/extended/korean.css` — 한국어 본문 줄바꿈(keep-all).

## 로컬
```
hugo server -D
sh scripts/check     # 빌드 통과 + 공개 금지 패턴 검사
```

## 배포
빌드 `hugo --minify`, 출력 `public`, `HUGO_VERSION=0.165.0`. 호스팅을 정하면 `hugo.yaml` 의 `baseURL` 을 맞춘다.
