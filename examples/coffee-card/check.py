"""Browser checks with an isolated browser filesystem, never the user's vault."""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('url')
parser.add_argument('--screenshots', type=Path, required=True)
args = parser.parse_args()
args.screenshots.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []
    for width in (1280, 390, 320):
        ctx = browser.new_context(viewport={'width':width,'height':960})
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url)
        expect(page.locator('#word')).not_to_be_visible()
        page.wait_for_function('document.querySelector("#photo").naturalWidth > 0')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        if width == 1280:
            page.screenshot(path=str(args.screenshots/'front.png'), full_page=True)
        page.get_by_role('button', name='정답 확인', exact=True).click()
        expect(page.locator('#word')).to_have_text('coffee')
        page.get_by_role('button', name='미국식 발음 듣기').click()
        page.wait_for_function('document.querySelector("#audio").ended')
        assert page.locator('#audio').evaluate('(audio) => audio.duration > .4 && audio.duration < 2')
        page.screenshot(path=str(args.screenshots/f'answer-{width}.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        ctx.close()
    print('PASS: front/reveal, MP3 playback, 1280/390/320 layouts')

    ctx = browser.new_context(viewport={'width':1280,'height':960})
    ctx.add_init_script('window.showDirectoryPicker = async () => navigator.storage.getDirectory();')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url)
    # Make this resemble a nonempty vault; only the dedicated child may be changed.
    page.evaluate('''async () => {
        const root = await navigator.storage.getDirectory();
        const file = await root.getFileHandle('my-existing-note.md', {create:true});
        const stream = await file.createWritable(); await stream.write('KEEP THIS NOTE'); await stream.close();
    }''')
    page.get_by_role('button', name='옵시디언 폴더 연결', exact=True).click()
    expect(page.locator('#connection-label')).to_have_text('coffee-예시 연결됨')
    page.get_by_role('button', name='변경 내용 저장', exact=True).click()
    expect(page.locator('#save')).to_have_text('파일에 저장됨')
    check_disk = '''async () => {
      const root = await navigator.storage.getDirectory();
      const d = await (await root.getDirectoryHandle('SayMore')).getDirectoryHandle('coffee-예시');
      const read = async n => (await (await d.getFileHandle(n)).getFile()).text();
      const media = await d.getDirectoryHandle('media');
      return { original:await (await (await root.getFileHandle('my-existing-note.md')).getFile()).text(),
        card:JSON.parse(await read('saymore-coffee.json')), review:JSON.parse(await read('review-state.json')), note:await read('coffee.md'),
        imageBytes:(await (await media.getFileHandle('coffee.jpg')).getFile()).size,
        audioBytes:(await (await media.getFileHandle('coffee.mp3')).getFile()).size };
    }'''
    saved = page.evaluate(check_disk)
    assert saved['original'] == 'KEEP THIS NOTE'
    assert saved['imageBytes'] > 100_000 and saved['audioBytes'] > 5_000
    assert saved['review']['count'] == 0
    page.get_by_role('button', name='정답 확인', exact=True).click()
    page.locator('[data-grade="good"]').click()
    expect(page.locator('#review-count')).to_have_text('1회')
    expect(page.locator('#save')).to_have_text('파일에 저장됨')
    saved = page.evaluate(check_disk)
    assert saved['review']['count'] == len(saved['review']['history']) == 1
    from datetime import datetime
    row = saved['review']['history'][0]
    assert (datetime.fromisoformat(row['due'].replace('Z','+00:00')) - datetime.fromisoformat(row['at'].replace('Z','+00:00'))).total_seconds() == 86400
    print('PASS: nonempty-vault isolation, media/note/state write, review schedule')

    page.reload()
    page.get_by_role('button', name='옵시디언 폴더 연결', exact=True).click()
    expect(page.locator('#review-count')).to_have_text('1회')
    page.evaluate('''async () => {
        const root = await navigator.storage.getDirectory();
        const d = await (await root.getDirectoryHandle('SayMore')).getDirectoryHandle('coffee-예시');
        const f = await d.getFileHandle('coffee.md'); const text = await (await f.getFile()).text();
        const w = await f.createWritable(); await w.write(text + '\\nKEEP MY OBSIDIAN MEMO\\n'); await w.close();
    }''')
    page.get_by_role('button', name='카드에 내 기억 더하기', exact=True).click()
    page.locator('#edit-memory').fill('Sunday café <img src=x onerror=alert(1)>')
    page.get_by_role('button', name='카드에 적용', exact=True).click()
    expect(page.locator('#save')).to_have_text('파일에 저장됨')
    saved = page.evaluate(check_disk)
    assert 'KEEP MY OBSIDIAN MEMO' in saved['note']
    assert '&lt;img' in saved['note'] and '<img src=x' not in saved['note']
    assert saved['review']['count'] == 1
    page.get_by_role('button', name='정답 확인', exact=True).click()
    expect(page.locator('#grades')).not_to_be_visible()
    assert page.locator('#memory img').count() == 0
    print('PASS: reload, extra Obsidian memo preservation, safe text, practice without extra reviews')

    # A concurrent change must prevent overwriting the other writer's review file.
    page.evaluate('''async () => {
        const root = await navigator.storage.getDirectory();
        const d = await (await root.getDirectoryHandle('SayMore')).getDirectoryHandle('coffee-예시');
        const f = await d.getFileHandle('review-state.json'); const text = await (await f.getFile()).text();
        const w = await f.createWritable(); await w.write(text + ' '); await w.close();
    }''')
    page.get_by_role('button', name='카드에 내 기억 더하기', exact=True).click()
    page.locator('#edit-sentence').fill('I like coffee.')
    page.get_by_role('button', name='카드에 적용', exact=True).click()
    expect(page.locator('#notice')).to_contain_text('덮어쓰지 않았습니다')
    assert page.evaluate(check_disk)['card']['card']['sentence'] == 'I drink coffee every morning.'
    print('PASS: concurrent file-change protection')
    ctx.close()

    ctx = browser.new_context()
    ctx.add_init_script('window.showDirectoryPicker = undefined;')
    page = ctx.new_page()
    page.goto(args.url)
    page.get_by_role('button', name='옵시디언 폴더 연결', exact=True).click()
    expect(page.locator('#notice')).to_contain_text('Chrome 또는 Edge')
    expect(page.locator('#connection-label')).to_have_text('연습 모드')
    print('PASS: unsupported-browser message')
    assert errors == [], errors
    browser.close()
    print('All coffee-card checks passed; the native folder chooser is not exercised by this test.')
