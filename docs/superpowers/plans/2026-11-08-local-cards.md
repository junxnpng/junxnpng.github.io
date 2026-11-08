# Local Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add and review multiple cards while keeping content, media, dates, and history in an Obsidian folder.

**Architecture:** A static page uses a pure card/scheduler module and a folder repository. One versioned JSON snapshot owns card and review state; Markdown is a readable export. A local vendored scheduler avoids runtime dependency requests.

**Tech Stack:** Native browser modules, File System Access, IndexedDB, Web Locks, ts-fsrs 5.4.2, Node test runner, Python Playwright, Hugo/GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-11-08-local-cards-design.md`

## Global Constraints

- No private files in the published repository; no Anki database writes or cloud sync.
- Existing coffee example and Obsidian data remain intact.
- FSRS-6 / ts-fsrs 5.4.2 / desired retention 0.9 / no fuzz.
- All save failures remain visible; failed canonical writes never advance in-memory review state.

## 1. Card state and scheduling

Files: `static/saymore/cards/model.mjs`, `vendor/ts-fsrs.mjs`, `tests/cards-model.test.mjs`.

Interfaces: `newLibrary(now)`, `newCard(fields, now)`, `editCard(card, fields, now)`, `rateCard(card, rating, now)`, `dueCards(library, now, deck)`, `parseLibrary(text)`, `renderNote(card, previous)`.

- [x] Write tests exercising serialization, separate schedules, due-date boundaries, edit preservation, and note safety. A representative invariant: `assert.equal(dueCards({cards:[reviewed]}, beforeDue).length, 0)`.
- [x] Run `node --test tests/cards-model.test.mjs` and observe missing behavior.
- [x] Add the pinned dependency with its license, implement the pure model, and rerun the tests.

## 2. Folder persistence

Files: `static/saymore/cards/storage.mjs`, `tests/cards_storage.py`.

Interfaces: `FolderStore.open(handle)`, `store.commit(nextLibrary, mediaMap, changedIds)`, `store.exportNotes()`, `store.readMedia(path)`, cached handle helpers. `store.library` changes only after a successful canonical write.

- [x] Write a real-browser storage test using a fresh OPFS directory. Save two cards and reload in a second store; expect both IDs and each review history to survive.
- [x] Test stale writes, writer collisions, invalid JSON, missing media, note preservation, and injected write denial. Verify the prior valid snapshot survives.
- [x] Implement folder resolution, snapshot validation, locked commit, backup, Markdown export, and optional remembered handle. Run the integration script.

## 3. Authoring and review interface

Files: `static/saymore/cards/index.html`, `app.mjs`, `app.css`, `view.mjs`, `sample/`, `tests/cards_browser.py`.

- [x] Add a failing browser flow: connect a folder, add two cards, reload, edit one, preview without recording, review the due card, and verify its new date on reload.
- [x] Build the editor with required-field feedback, attachment validation, live front/back preview, and save-and-next. Render library search/deck filters and independent card histories.
- [x] Build due-card review using `rateCard`, recording only after save succeeds. Support saved-handle reconnect and an explicit unsupported-browser explanation.
- [x] Verify at 1280, 390, and 320 pixels; inspect screenshots and ensure personal field values never become HTML.

## 4. Entry points and publication

Files: `layouts/home.html`, `examples/coffee-card/demo.html`, generated example HTML, `README.md`, `static/saymore/cards/README.md`.

- [x] Link home to the working card collection and the old example to the new editor. Rebuild the self-contained example from its public seed media only.
- [x] Run `node --test tests/cards-model.test.mjs`, storage/browser checks, and `sh scripts/check`.
- [ ] Review only this task's diff, commit, fast-forward push, wait for Pages, and verify the published add route and home link.

## Reference sources

- https://docs.ankiweb.net/manual/editing
- https://docs.ankiweb.net/manual/studying
- https://github.com/open-spaced-repetition/ts-fsrs
- https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
- https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable
