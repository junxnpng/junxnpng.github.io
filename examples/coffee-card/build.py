"""Build a self-contained demo and seed a new Obsidian example folder."""
import argparse
import base64
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser()
parser.add_argument('--media', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--vault-example', type=Path)
args = parser.parse_args()
source = Path(__file__).parent
card = {
    'id': 'coffee-example', 'word': 'coffee', 'ipa': '/ˈkɑː.fi/',
    'sentence': 'I drink coffee every morning.',
    'memory': 'Sunday morning · my favorite café',
    'imagePath': 'media/coffee.jpg', 'audioPath': 'media/coffee.mp3',
    'imageCredit': '사진 · Julius Schorzman · CC BY-SA 2.0',
    'audioCredit': '음성 · Dvortygirl · CC BY-SA 3.0 (Wikimedia MP3 변환본)',
}
seed = {'card': card}
for kind, filename, mime in [('image','coffee.jpg','image/jpeg'),('audio','coffee.mp3','audio/mpeg')]:
    seed[kind] = f'data:{mime};base64,' + base64.b64encode((args.media / filename).read_bytes()).decode()
html = (source / 'demo.html').read_text().replace('__SAYMORE_SEED__', json.dumps(seed, ensure_ascii=False).replace('</','<\\/')).replace('__SAYMORE_SCRIPT__', (source/'demo.js').read_text())
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html)
print('Built', args.output, args.output.stat().st_size, 'bytes')
if args.vault_example:
    if args.vault_example.exists():
        raise SystemExit('Refusing to seed an existing folder. No existing vault files were changed.')
    args.vault_example.mkdir(parents=True)
    shutil.copytree(args.media, args.vault_example/'media')
    (args.vault_example/'카드 미리보기.html').write_text(html)
    (args.vault_example/'saymore-coffee.json').write_text(json.dumps({'format':'saymore-coffee-example','version':1,'card':card}, ensure_ascii=False, indent=2)+'\n')
    (args.vault_example/'review-state.json').write_text(json.dumps({'cardId':'coffee-picture-to-word','count':0,'history':[],'due':None}, indent=2)+'\n')
    (args.vault_example/'coffee.md').write_text(f'''<!-- saymore:card:start -->
# coffee

{card['ipa']} · 미국식

![학습 사진](media/coffee.jpg)

![[media/coffee.mp3]]

## 예문
{card['sentence']}

## 나의 기억
{card['memory']}

## 연습 방법
사진을 보고 coffee를 소리 내어 말한 뒤, 음성을 듣고 확인합니다.
복습 날짜와 결과는 같은 폴더의 review-state.json에 저장합니다.

## 출처
{card['imageCredit']}

{card['audioCredit']}

- 사진 원본: https://commons.wikimedia.org/wiki/File:A_small_cup_of_coffee.JPG
- 음성 원본: https://commons.wikimedia.org/wiki/File:En-us-coffee.ogg
- 사진 라이선스: https://creativecommons.org/licenses/by-sa/2.0/
- 음성 라이선스: https://creativecommons.org/licenses/by-sa/3.0/
- 발음 참고: https://en.wiktionary.org/wiki/coffee#Pronunciation

사진·음성을 직접 교체하면 해당 파일의 출처가 적용됩니다. 기본 사진은 원본 그대로, 기본 음성은 Wikimedia MP3 변환본입니다.
<!-- saymore:card:end -->

## 추가 메모
이 아래에는 옵시디언에서 자유롭게 메모해도 됩니다.
''')
    print('Created Obsidian example', args.vault_example)
