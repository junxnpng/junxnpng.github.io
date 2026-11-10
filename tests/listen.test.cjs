const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { globalThis: {} };
vm.runInNewContext(fs.readFileSync('assets/js/saymore-listen-core.js', 'utf8'), context);
const core = context.globalThis.SayMoreListen;
const data = JSON.parse(fs.readFileSync('data/saymore/minimal_pairs.json', 'utf8'));
const guide = JSON.parse(fs.readFileSync('data/saymore/ipa.json', 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));

test('every pair has two different words and each sound links to the IPA guide entry with that symbol', () => {
  const symbols = new Map(guide.groups.flatMap(g => g.items).map(item => [item.number, item.symbol]));
  const ids = new Set();
  for (const set of data.sets) {
    assert.ok(!ids.has(set.id)); ids.add(set.id);
    assert.equal(set.sounds.length, 2);
    for (const sound of set.sounds) assert.equal(symbols.get(sound.guide), sound.symbol, `${set.id} ${sound.symbol}`);
    assert.ok(set.pairs.length >= 3);
    for (const pair of set.pairs) {
      assert.equal(pair.length, 2);
      assert.notEqual(pair[0].word.toLowerCase(), pair[1].word.toLowerCase());
      assert.notEqual(pair[0].ipa, pair[1].ipa);
      pair.forEach((item, i) => {
        assert.match(item.ipa, /^\/.+\/$/);
        assert.ok(item.ipa.includes(set.sounds[i].symbol), `${item.word} ${item.ipa} lacks ${set.sounds[i].symbol}`);
      });
    }
  }
});

test('answers are recorded per contrast and damaged saved records are ignored', () => {
  let state = core.empty();
  state = core.record(state, 'r-l', true);
  state = core.record(state, 'r-l', false);
  assert.deepEqual(plain(state.sets['r-l']), { attempts: 2, correct: 1 });
  assert.deepEqual(plain(core.parse(JSON.stringify(state))), plain(state));
  assert.deepEqual(plain(core.parse('not json')), plain(core.empty()));
  const damaged = JSON.stringify({ format: 'saymore-listen', version: 1, sets: { a: { attempts: 1, correct: 5 }, b: { attempts: 2, correct: 2 } } });
  assert.deepEqual(plain(core.parse(damaged).sets), { b: { attempts: 2, correct: 2 } });
});

test('weak and unpractised contrasts are offered more often than mastered ones', () => {
  let state = core.empty();
  for (let i = 0; i < 10; i++) state = core.record(state, 'strong', true);
  for (let i = 0; i < 10; i++) state = core.record(state, 'weak', i < 2);
  assert.ok(core.weight(state, 'weak') > core.weight(state, 'new'));
  assert.ok(core.weight(state, 'new') > core.weight(state, 'strong'));
  const sets = ['strong', 'weak'].map(id => ({ id, pairs: [[{}, {}], [{}, {}]] }));
  let seed = 1; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let weak = 0;
  for (let i = 0; i < 2000; i++) if (core.pickSet(sets, state, random).id === 'weak') weak++;
  assert.ok(weak > 1500, `weak picked ${weak} of 2000`);
});

test('the same pair is not asked twice in a row and both words are used as answers', () => {
  const set = data.sets[0];
  let seed = 7; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let previous = null; const answers = new Set();
  for (let i = 0; i < 200; i++) {
    const trial = core.nextTrial([set], core.empty(), previous, random);
    if (previous) assert.notEqual(trial.pairIndex, previous.pairIndex);
    answers.add(trial.answer); previous = trial;
  }
  assert.deepEqual([...answers].sort(), [0, 1]);
});
