import test from 'node:test';
import assert from 'node:assert/strict';
import {newLibrary, newCard, editCard, rateCard, reviewOptions, dueCards, parseLibrary, renderNote} from '../static/saymore/cards/model.mjs';

const now = new Date('2026-11-08T12:00:00Z');
const fields = {type:'basic', deck:'첫 100단어', front:'A drink made from roasted beans', answer:'coffee', tags:'food morning'};

test('rating one card leaves another card new and hides the rated card until due', () => {
  const a = newCard(fields, now), b = newCard({...fields, answer:'tea'}, now);
  const rated = rateCard(a, 4, now);
  assert.equal(a.reviews.length, 0);
  assert.equal(rated.reviews.length, 1);
  assert.equal(rated.reviews[0].rating, 4);
  assert.ok(Date.parse(rated.schedule.due) > now.getTime());
  const library = {...newLibrary(now), cards:[rated,b]};
  assert.deepEqual(dueCards(library, now).map(c=>c.id), [b.id]);
  assert.ok(dueCards(library, new Date(rated.schedule.due)).some(c=>c.id===a.id));
  assert.throws(()=>rateCard(rated,3,now));
});

test('serialized schedules and review histories can be resumed after reload', () => {
  const a=rateCard(newCard(fields,now),3,now);
  const library={...newLibrary(now),cards:[a]};
  const loaded=parseLibrary(JSON.stringify(library));
  const next=rateCard(loaded.cards[0],3,new Date(a.schedule.due));
  assert.equal(next.reviews.length,2);
  assert.ok(Date.parse(next.schedule.due)>Date.parse(a.schedule.due));
  assert.equal(loaded.cards[0].reviews.length,1);
  const options=reviewOptions(newCard(fields,now),now);
  assert.ok(Date.parse(options[1].due)<Date.parse(options[4].due));
});

test('editing content preserves card identity, schedule, and history',()=>{
  const a=rateCard(newCard(fields,now),4,now);
  const edited=editCard(a,{...fields,answer:'coffee!',memory:'my café'},now);
  assert.equal(edited.id,a.id);
  assert.deepEqual(edited.schedule,a.schedule);
  assert.deepEqual(edited.reviews,a.reviews);
  assert.equal(edited.answer,'coffee!');
});

test('rejects empty cards, missing picture, unsafe media, duplicate IDs and broken schedules',()=>{
  assert.throws(()=>newCard({...fields,answer:'  '},now));
  assert.throws(()=>newCard({...fields,type:'picture'},now));
  assert.throws(()=>newCard({...fields,image:{path:'../private.jpg',credit:''}},now));
  const a=newCard(fields,now), l={...newLibrary(now),cards:[a,a]};
  assert.throws(()=>parseLibrary(JSON.stringify(l)));
  a.schedule.due='invalid';
  assert.throws(()=>parseLibrary(JSON.stringify({...l,cards:[a]})));
  assert.throws(()=>parseLibrary('{"format":"other","cards":[]}'));
  const badTags=newCard(fields,now); badTags.tags='unparsed text';
  assert.throws(()=>parseLibrary(JSON.stringify({...newLibrary(now),cards:[badTags]})));
});

test('Markdown export shows dates and preserves personal notes outside its generated block',()=>{
  const a=rateCard(newCard({...fields,memory:'<img src=x> ![link](https://bad.example)',audio:{path:'media/00000000-0000-0000-0000-000000000001.mp3',credit:'recording'}},now),4,now);
  const note=renderNote(a);
  assert.ok(note.includes('![[00000000-0000-0000-0000-000000000001.mp3]]'));
  assert.ok(note.includes(a.schedule.due));
  assert.ok(!note.includes('<img'));
  assert.ok(!note.includes('![link]'));
  const previous='Private introduction\n'+note+'\nMy extra note';
  const updated=renderNote(editCard(a,{...fields,answer:'tea'},now),previous);
  assert.ok(updated.startsWith('Private introduction\n'));
  assert.ok(updated.endsWith('My extra note'));
  assert.throws(()=>renderNote(a,'An unrelated existing note'));
});
