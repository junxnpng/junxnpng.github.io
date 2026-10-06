"""Run against a Hugo server: python tests/study_browser.py [base URL]."""
import sys
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:1313'

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE + '/study/basic-verbs/day-01/')
    page.wait_for_load_state('networkidle')
    expect(page.locator('.study-card')).to_have_count(20)
    first = page.locator('.study-card').first
    expect(first.locator('.study-tag')).to_have_text('1티어 · 핵심 발화')
    expect(first.locator('.study-example')).not_to_be_visible()
    first.get_by_text('예문 확인', exact=True).click()
    expect(first.locator('.study-example')).to_be_visible()
    first.get_by_role('checkbox', name='학습 완료').check()
    expect(page.locator('[data-day-progress]')).to_have_text('1 / 20 학습 완료')
    page.reload()
    expect(first.get_by_role('checkbox', name='학습 완료')).to_be_checked()
    page.get_by_role('checkbox', name='미완료만').check()
    expect(page.locator('.study-card:visible')).to_have_count(19)
    page.get_by_role('checkbox', name='미완료만').uncheck()
    page.get_by_role('searchbox').fill('receive')
    expect(page.locator('.study-card:visible')).to_have_count(1)
    page.get_by_role('searchbox').fill('없는표현')
    expect(page.locator('[data-empty]')).to_be_visible()
    page.get_by_role('searchbox').fill('')
    page.get_by_role('button', name='예문 모두 펼치기').click()
    expect(page.locator('details[data-example][open]')).to_have_count(20)
    page.get_by_role('button', name='예문 모두 접기').click()
    expect(page.locator('details[data-example][open]')).to_have_count(0)
    page.get_by_role('link', name='다음 날 · 2일차').last.click()
    expect(page).to_have_url(BASE + '/study/basic-verbs/day-02/')
    page.get_by_role('combobox', name='티어').select_option('1')
    expect(page.locator('.study-card:visible')).to_have_count(7)
    page.goto(BASE + '/study/basic-verbs/')
    expect(page.locator('[data-course-progress]')).to_have_text('1 / 285 학습 완료')
    expect(page.locator('[data-day-link]')).to_have_count(14)
    expect(page.locator('[data-day-link]').first).to_contain_text('핵심 20개')
    page.screenshot(path='/tmp/athena-study-index.png', full_page=True)
    total = 0
    for day in range(1, 15):
        response = page.goto(BASE + f'/study/basic-verbs/day-{day:02}/')
        assert response.status == 200
        total += page.locator('.study-card').count()
        for href in page.locator('.study a[href^="/study/"]').evaluate_all('(links) => links.map(a => a.pathname)'):
            assert context.request.get(BASE + href).status == 200, href
    assert total == 285, total
    page.goto(BASE + '/study/basic-verbs/day-01/#GET-B010')
    assert page.locator('#GET-B010').evaluate('(el) => el.getBoundingClientRect().top') < 250
    page.goto(BASE + '/study/basic-verbs/day-01/')
    page.screenshot(path='/tmp/athena-study-desktop.png')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.reload()
    page.screenshot(path='/tmp/athena-study-mobile.png')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile overflow'
    page.get_by_role('button', name='Toggle theme').click()
    page.screenshot(path='/tmp/athena-study-dark.png')
    # Storage can be unavailable or contain malformed JSON; study must stay usable.
    blocked = browser.new_context()
    blocked.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });")
    no_storage = blocked.new_page()
    no_storage.goto(BASE + '/study/basic-verbs/day-01/')
    expect(no_storage.locator('.study-card')).to_have_count(20)
    no_storage.locator('.study-card').first.get_by_role('checkbox', name='학습 완료').check()
    expect(no_storage.locator('[data-day-progress]')).to_have_text('1 / 20 학습 완료')
    expect(no_storage.locator('[data-storage-note]')).to_be_visible()
    assert not errors, errors
    browser.close()
    print('PASS: 14 days, 285 cards, examples, filters, persisted progress, navigation, mobile, dark theme, storage fallback')
