# Local flashcards

The accepted coffee example becomes an entry point to a usable card collection. The user requested an Anki-inspired add interface and storage of both cards and review dates in their Obsidian folder.

## Experience

Keep Say More's blue accent, slate text, spacious forms, and large serif answer from the accepted example. Use a compact collection workspace, not another marketing hero. The main actions are 카드 목록, 카드 추가, and 오늘 복습. The editor places front/back fields beside an actual card preview. A separate storage strip always identifies whether a folder is connected.

Support picture-to-word and basic front/back cards, a deck name, tags, IPA, example sentence, personal memory, JPG/PNG/WebP and MP3. Adding another card retains deck/type. Editing never resets its schedule. Browsing previews never counts as study. Review uses four ratings and shows their next intervals. Future cards remain in the library but do not enter the due queue.

## Persistence

Chrome/Edge File System Access writes to `SayMore/카드` in the selected vault. Selecting an existing collection directory also works. Do not upload personal data. Remember the directory handle in IndexedDB when supported; reconnect only with granted permission or a user click. No connection means no misleading saved state.

`library.json` is the authoritative versioned snapshot of cards, FSRS state, and review logs. Save media first, then atomically close the library writer. Keep a previous valid snapshot in `library.backup.json`. Export each card as `notes/<id>.md` with due date and history, preserving user text outside generated markers. A failed note export is reported separately from a committed library save and can be retried. Use Web Locks, an exclusive writable stream, and stale-snapshot detection. Refuse unknown collection formats, unsafe paths, invalid schedules, and accidental overwrites of unrelated notes.

Use locally vendored MIT-licensed ts-fsrs 5.4.2 (FSRS-6), desired retention 0.9, fuzz disabled. Pin the implementation and parameters in the collection. This is an independent collection, not synchronization with the user's Anki database or AnkiWeb. Preserve the existing coffee example and its stored data.

## Verification

Model tests cover independent card schedules, due filtering, serialization, editing without reset, invalid data, and note preservation. Real Chromium OPFS integration covers multi-card save/reload, media, failure, stale writes, same-origin concurrency, and permission errors. Browser tests cover add/edit/preview/review, reconnect, desktop/mobile layouts, and the home link. Native macOS folder selection remains user-mediated; tests must not claim they automate it.
