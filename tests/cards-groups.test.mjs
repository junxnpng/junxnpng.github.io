import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {newCard,editCard,rateCard,copy} from '../static/saymore/cards/model.mjs';
let groups;
if(existsSync('static/saymore/cards/study-groups.mjs'))groups=await import('../static/saymore/cards/study-groups.mjs');
const now=new Date('2026-11-10T01:00:00Z');
const card=(answer,deck,tags=[])=>newCard({type:'basic',front:'Recall the word.',answer,deck,tags},now);

test('word batches cover all 629 cards once and never include IPA cards',()=>{
  assert.ok(groups,'study group selection is not implemented');
  const words=Array.from({length:629},(_,i)=>card(`word ${i+1}`,'Fluent Forever · First 625',['FF625']));
  const ipa=Array.from({length:67},(_,i)=>card(`sound ${i+1}`,'IPA 01 · 모음',['IPA']));
  const input=[...words.slice(0,50),...ipa,...words.slice(50)],before=copy(input);
  const batches=groups.studyGroups(input).filter(g=>g.key.startsWith('words:'));
  assert.deepEqual(batches.map(g=>g.cards.length),[100,100,100,100,100,100,29]);
  assert.deepEqual(batches.flatMap(g=>g.cards.map(c=>c.id)),words.map(c=>c.id));
  assert.equal(batches[0].cards[99].answer,'word 100');
  assert.equal(batches[1].cards[0].answer,'word 101');
  assert.equal(batches[6].cards.at(-1).answer,'word 629');
  assert.deepEqual(input,before);
});

test('ratings, content edits and due order cannot move a word to another batch',()=>{
  assert.ok(groups);
  const cards=Array.from({length:102},(_,i)=>card(`word ${i+1}`,'renamed deck',['FF625']));
  cards[0]=rateCard(cards[0],4,now);
  cards[100]=editCard(cards[100],{...cards[100],answer:'my correction'});
  assert.deepEqual(groups.cardsInGroup(cards,'words:2').map(c=>c.id),[cards[100].id,cards[101].id]);
  assert.equal(groups.cardsInGroup(cards,'words:1').length,100);
});

test('due and unknown queues stay in the selected group, while practice includes future cards',()=>{
  assert.ok(groups);
  const unknown=rateCard(card('forgotten','IPA 01 · 모음',['IPA']),1,now);
  const known=rateCard(card('known','IPA 01 · 모음',['IPA']),4,now);
  const fresh=card('new','IPA 01 · 모음',['IPA']);
  const other=rateCard(card('other','Fluent Forever · First 625',['FF625']),1,now);
  const cards=[unknown,known,fresh,other],before=copy(cards);
  assert.deepEqual(groups.studyQueue(cards,'ipa','due',now).map(c=>c.answer),['new']);
  assert.deepEqual(groups.studyQueue(cards,'ipa','unknown',now).map(c=>c.answer),['forgotten']);
  assert.deepEqual(groups.studyQueue(cards,'ipa','practice',now).map(c=>c.answer),['forgotten','known','new']);
  assert.deepEqual(groups.studyQueue(cards,'words','practice',now).map(c=>c.answer),['other']);
  assert.deepEqual(cards,before);
});

test('IPA sections and personal decks are selectable and an unknown group cannot fall back to all cards',()=>{
  assert.ok(groups);
  const vowel=card('vowel','IPA 01 · 모음',['IPA']);
  const consonant=card('consonant','IPA 02 · 자음',['IPA']);
  const custom=card('custom','My own deck');
  const cards=[vowel,consonant,custom];
  const options=groups.studyGroups(cards);
  const section=options.find(g=>g.label===vowel.deck),own=options.find(g=>g.label===custom.deck);
  assert.deepEqual(groups.cardsInGroup(cards,section.key).map(c=>c.answer),['vowel']);
  assert.deepEqual(groups.cardsInGroup(cards,own.key).map(c=>c.answer),['custom']);
  assert.deepEqual(groups.studyQueue(cards,'words:99','due',now),[]);
});
