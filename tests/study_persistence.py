"""Verify progress across tabs, browser restart, and old saved records."""
import sys
import tempfile
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:1313'
COURSE = BASE + '/study/basic-verbs/'

with sync_playwright() as p, tempfile.TemporaryDirectory() as profile:
    context = p.chromium.launch_persistent_context(profile, headless=True)
    first = context.new_page()
    second = context.new_page()
    overview = context.new_page()
    first.goto(COURSE + 'day-01/')
    second.goto(COURSE + 'day-02/')
    overview.goto(COURSE)
    first.locator('[data-done]').first.check()
    second.locator('[data-done]').first.check()
    first.reload()
    expect(first.locator('[data-done]').first).to_be_checked()
    expect(overview.locator('[data-course-progress]')).to_have_text('2 / 285 학습 완료')
    # Two views of the same day must receive each other's changes.
    same_day = context.new_page()
    same_day.goto(COURSE + 'day-01/')
    same_day.locator('[data-done]').first.uncheck()
    expect(first.locator('[data-done]').first).not_to_be_checked()
    first.locator('[data-done]').first.check()
    expect(same_day.locator('[data-done]').first).to_be_checked()
    # Returning through browser history must also show the latest saved check.
    first.goto(COURSE + 'day-02/')
    same_day.locator('[data-done]').first.uncheck()
    first.go_back()
    expect(first.locator('[data-done]').first).not_to_be_checked()
    first.locator('[data-done]').first.check()
    context.close()
    context = p.chromium.launch_persistent_context(profile, headless=True)
    reopened = context.new_page()
    reopened.goto(COURSE + 'day-01/')
    expect(reopened.locator('[data-done]').first).to_be_checked()
    reopened.goto(COURSE + 'day-02/')
    expect(reopened.locator('[data-done]').first).to_be_checked()
    # Keep historical progress readable; unchecking an old entry must persist.
    reopened.evaluate("localStorage.clear(); localStorage.setItem('jun-study.basic-verbs.completed.v1', JSON.stringify(['GET-B001']))")
    reopened.goto(COURSE + 'day-01/')
    expect(reopened.locator('[data-done]').first).to_be_checked()
    reopened.locator('[data-done]').first.uncheck()
    reopened.reload()
    expect(reopened.locator('[data-done]').first).not_to_be_checked()
    reopened.locator('[data-done]').nth(1).check()
    reopened.reload()
    expect(reopened.locator('[data-done]').nth(1)).to_be_checked()
    context.close()
    print('PASS: separate tabs preserve checks, open views update, browser restart persists, old records remain usable')
