"""Assemble the gallery: engine.html + data.js -> saymore-drafts-100.html, with a Google Fonts link for exactly the faces the drafts use."""
import re, sys, json, pathlib, urllib.parse
here = pathlib.Path(__file__).parent
engine = (here / 'engine.html').read_text()
data = (here / 'data.js').read_text()

KO = {'N': 'Noto Sans KR', 'S': 'Noto Serif KR', 'G': 'Gowun Dodum', 'B': 'Gowun Batang', 'P': 'IBM Plex Sans KR',
      'H': 'Black Han Sans', 'J': 'Jua', 'M': 'Hahmlet', 'D': 'Do Hyeon',
      'NG': 'Nanum Gothic', 'NM': 'Nanum Myeongjo', 'A1': 'Gothic A1', 'SF': 'Sunflower', 'OR': 'Orbit', 'NC': 'Nanum Gothic Coding', 'Y': None}
# Weights each family actually ships on Google Fonts (single-weight faces take no axis).
WEIGHTS = json.loads((here / 'weights.json').read_text())

used = set()
for m in re.finditer(r"ko:'([^']+)'", data):
    used.add(KO[m.group(1)])
for m in re.finditer(r"(?:en|hd):'([^']+)'", data):
    used.add(m.group(1))
used.discard(None)
missing = sorted(f for f in used if f not in WEIGHTS)
if missing:
    sys.exit('No weight entry for: ' + ', '.join(missing))
parts = []
for f in sorted(used):
    w = WEIGHTS[f]
    parts.append('family=' + f.replace(' ', '+') + (':wght@' + ';'.join(map(str, w)) if w else ''))
url = 'https://fonts.googleapis.com/css2?' + '&amp;'.join(parts) + '&amp;display=swap'
out = engine.replace('__FONTS__', url).replace('__DATA__', data)
(here.parent / 'saymore-drafts-100.html').write_text(out)
n = len(re.findall(r"\{n:'", data))
print(n, 'themes;', len(used), 'font families;', len(out) // 1024, 'KB')
