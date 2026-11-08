const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { globalThis: {} };
const file = 'assets/js/saymore-progress-core.js';
if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
const core = context.globalThis.SayMoreProgress;
const empty = () => ({ format: 'saymore-ipa-progress', version: 1, items: {} });
const item = (mastered, updatedAt, changeId = 'change-a') => ({ mastered, updatedAt, changeId });

test('combines edits to different sounds from two devices', () => {
  assert.ok(core, 'progress storage is not implemented');
  const a = empty(), b = empty();
  a.items['ipa-1'] = item(true, '2026-11-09T00:00:00.000Z');
  b.items['glottal-stop'] = item(true, '2026-11-09T00:00:01.000Z');
  const merged = core.merge(a, b);
  assert.equal(merged.items['ipa-1'].mastered, true);
  assert.equal(merged.items['glottal-stop'].mastered, true);
});

test('an older backup cannot restore a sound that was later unchecked', () => {
  assert.ok(core);
  const old = empty(), recent = empty();
  old.items['ipa-1'] = item(true, '2026-11-08T00:00:00.000Z');
  recent.items['ipa-1'] = item(false, '2026-11-09T00:00:00.000Z');
  assert.equal(core.merge(recent, old).items['ipa-1'].mastered, false);
  assert.equal(core.merge(old, recent).items['ipa-1'].mastered, false);
});

test('invalid progress is rejected before any valid records are applied', () => {
  assert.ok(core);
  const broken = empty();
  broken.items['ipa-1'] = item(true, 'not a date');
  assert.throws(() => core.parse(JSON.stringify(broken)));
  broken.items['ipa-1'] = item('yes', '2026-11-09T00:00:00.000Z');
  assert.throws(() => core.parse(JSON.stringify(broken)));
  assert.throws(() => core.parse('{"format":"saymore-ipa-progress","version":2,"items":{}}'));
  assert.throws(() => core.parse('{"format":"saymore-ipa-progress","version":1,"items":{"__proto__":{}}}'));
});

test('simultaneous edits resolve identically regardless of merge order', () => {
  assert.ok(core);
  const a = empty(), b = empty();
  a.items['ipa-1'] = item(true, '2026-11-09T00:00:00.000Z', 'a');
  b.items['ipa-1'] = item(false, '2026-11-09T00:00:00.000Z', 'b');
  assert.equal(core.merge(a, b).items['ipa-1'].mastered, false);
  assert.equal(core.merge(b, a).items['ipa-1'].mastered, false);
});

test('Dropbox conflict retry preserves an intervening edit from another device', async () => {
  assert.ok(core);
  const local = empty(), remote = empty();
  local.items['ipa-1'] = item(true, '2026-11-09T00:00:00.000Z');
  let version = 0;
  let stored;
  const result = await core.sync(local, {
    read: async () => ({ state: remote, rev: String(version) }),
    write: async (next, rev) => {
      if (version === 0) {
        remote.items['ipa-2'] = item(true, '2026-11-09T00:00:01.000Z');
        version++;
        throw Object.assign(new Error('conflict'), { conflict: true });
      }
      assert.equal(rev, '1');
      stored = next;
    }
  });
  assert.equal(result.items['ipa-1'].mastered, true);
  assert.equal(stored.items['ipa-2'].mastered, true);
});

test('a failed upload never reports success or drops the local edit', async () => {
  assert.ok(core);
  const local = empty();
  local.items['ipa-1'] = item(true, '2026-11-09T00:00:00.000Z');
  await assert.rejects(core.sync(local, {
    read: async () => ({ state: empty(), rev: null }),
    write: async () => { throw Error('offline'); }
  }), /offline/);
  assert.equal(local.items['ipa-1'].mastered, true);
});
