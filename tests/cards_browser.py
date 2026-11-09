"""Card authoring/review flow with an isolated test folder, not the user's vault."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

url=sys.argv[1].rstrip('/')+'/saymore/cards/'
out=Path(sys.argv[2] if len(sys.argv)>2 else '/tmp/saymore-cards-qa')
out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':1280,'height':1000})
    context.add_init_script('''window.showDirectoryPicker = async () => {
      const root=await navigator.storage.getDirectory();
      return root.getDirectoryHandle('test-vault',{create:true});
    };''')
    page=context.new_page()
    page.set_default_timeout(5000)
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.goto(url)
    page.get_by_role('button',name='폴더 연결',exact=True).click()
    expect(page.locator('#connection')).to_contain_text('연결됨')
    page.get_by_role('button',name='카드 추가',exact=True).click()
    page.get_by_label('카드 종류',exact=True).select_option('basic')
    page.get_by_label('앞면 · 질문 또는 힌트',exact=True).fill('A hot drink')
    page.get_by_label('뒷면 · 단어 또는 정답',exact=True).fill('coffee')
    page.get_by_label('나의 기억',exact=True).fill('<img src=x onerror=alert(1)>')
    page.get_by_role('button',name='추가하고 다음 카드',exact=True).click()
    expect(page.locator('#notice')).to_contain_text('저장')
    expect(page.locator('#total-count')).to_have_text('1')
    page.get_by_label('앞면 · 질문 또는 힌트',exact=True).fill('A green drink')
    page.get_by_label('뒷면 · 단어 또는 정답',exact=True).fill('tea')
    page.get_by_role('button',name='저장하고 목록 보기',exact=True).click()
    expect(page.locator('#card-list > article')).to_have_count(2)
    page.reload()
    expect(page.locator('#connection')).to_contain_text('연결됨')
    expect(page.locator('#card-list > article')).to_have_count(2)
    row=page.locator('#card-list > article').filter(has=page.get_by_role('heading',name='coffee',exact=True))
    row.get_by_role('button',name='미리 보기',exact=True).click()
    expect(page.locator('#detail-dialog')).to_be_visible()
    page.get_by_role('button',name='뒷면 보기',exact=True).click()
    expect(page.locator('#detail-card')).to_contain_text('<img src=x onerror=alert(1)>')
    assert page.locator('#detail-card img').count()==0
    page.get_by_role('button',name='닫기',exact=True).click()
    row.get_by_role('button',name='수정',exact=True).click()
    page.get_by_label('예문',exact=True).fill('I drink coffee.')
    page.get_by_role('button',name='저장하고 목록 보기',exact=True).click()
    page.get_by_role('button',name='복습하기',exact=True).click()
    page.get_by_role('button',name='정답 확인',exact=True).click()
    expect(page.locator('#review-card')).to_contain_text('coffee')
    page.evaluate('''() => {
      window.originalWriter=FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable=function(options){
        if(this.name==='library.json')throw new DOMException('test denial','NotAllowedError');
        return window.originalWriter.call(this,options);
      };
    }''')
    page.locator('[data-rating="4"]').click()
    expect(page.locator('#notice')).to_contain_text('권한')
    expect(page.locator('#review-card')).to_contain_text('coffee')
    page.evaluate('() => {FileSystemFileHandle.prototype.createWritable=window.originalWriter;}')
    page.locator('[data-rating="4"]').click()
    expect(page.locator('#notice')).to_contain_text('저장')
    page.get_by_role('button',name='카드 목록',exact=True).click()
    expect(row).to_contain_text('1회')
    page.reload()
    expect(page.locator('#connection')).to_contain_text('연결됨')
    expect(row).to_contain_text('1회')
    stored=page.evaluate('''async()=>{
      const root=await navigator.storage.getDirectory();
      const v=await root.getDirectoryHandle('test-vault');
      const s=await v.getDirectoryHandle('SayMore'); const d=await s.getDirectoryHandle('카드');
      return JSON.parse(await (await (await d.getFileHandle('library.json')).getFile()).text());
    }''')
    assert len(stored['cards'])==2
    assert stored['cards'][0]['reviews'][0]['rating']==4
    assert stored['cards'][1]['reviews']==[]
    print('PASS: create multiple cards, reload, edit, safe preview, record review and due date')
    page.get_by_role('button',name='카드 추가',exact=True).click()
    page.get_by_role('button',name='coffee 예시로 채우기',exact=True).click()
    expect(page.locator('#preview-card img')).to_be_visible()
    assert 'coffee' not in page.locator('#preview-card').inner_text()
    page.locator('#audio').set_input_files({'name':'broken.mp3','mimeType':'audio/mpeg','buffer':b'not an MP3'})
    expect(page.locator('#editor-error')).to_be_visible()
    page.locator('#image').set_input_files(str(Path(__file__).parent.parent/'static/saymore/cards/sample/coffee.jpg'))
    expect(page.locator('#save-list')).to_be_enabled()
    for width in [1280,390,320]:
        page.set_viewport_size({'width':width,'height':1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),width
        page.screenshot(path=str(out/f'editor-{width}.png'),full_page=True)
    page.get_by_role('button',name='저장하고 목록 보기',exact=True).click()
    expect(page.locator('#card-list > article')).to_have_count(3)
    page.screenshot(path=str(out/'library.png'),full_page=True)
    assert not errors,errors
    print('PASS: sample photo/audio attachments; 1280/390/320px layouts; no page errors')
    context.close()
    context=browser.new_context()
    context.add_init_script('window.showDirectoryPicker=undefined;')
    page=context.new_page();page.goto(url)
    expect(page.locator('#browser-support')).to_contain_text('Chrome')
    page.get_by_role('button',name='카드 추가',exact=True).click()
    expect(page.locator('#save-next')).to_be_disabled()
    print('PASS: unsupported browser cannot falsely claim a saved card')
    browser.close()
