import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../static/saymore/cards/model.mjs';
import {flagKinds,hasFlag,setFlag} from '../static/saymore/cards/image-flag.mjs';
const imageFlagTag=flagKinds.word.tag,hasImageFlag=card=>hasFlag(card,'word'),flagImage=(card,on,now)=>setFlag(card,'word',on,now);

const image={path:'media/00000000-0000-4000-8000-000000000001.jpg',credit:''};
const studied=()=>{
  const start=new Date('2026-11-01T09:00:00Z');
  let card=model.newCard({type:'picture',deck:'Fluent Forever · First 625',answer:'dog',sentence:'The dog runs.',tags:['FF625'],image},start);
  card=model.rateCard(card,3,start);
  return card;
};

test('flagging a picture adds only the tag; the schedule and review history stay as they were',()=>{
  const card=studied(),flagged=flagImage(card,true,new Date('2026-11-12T00:00:00Z'));
  assert.equal(hasImageFlag(card),false);
  assert.equal(hasImageFlag(flagged),true);
  assert.deepEqual(flagged.tags,['FF625',imageFlagTag]);
  assert.deepEqual(flagged.schedule,card.schedule);
  assert.deepEqual(flagged.reviews,card.reviews);
  const {tags:a,updatedAt:b,...rest}=flagged,{tags:c,updatedAt:d,...before}=card;
  assert.deepEqual(rest,before);
  assert.deepEqual(card.tags,['FF625'],'the original card is not modified');
});

test('a flagged card is still a valid library card and can be reviewed and unflagged',()=>{
  const flagged=flagImage(studied(),true);
  const library={...model.newLibrary(),cards:[flagged]};
  assert.equal(model.parseLibrary(JSON.stringify(library)).cards[0].tags.includes(imageFlagTag),true);
  assert.deepEqual(flagImage(flagged,true).tags,flagged.tags,'flagging twice keeps one tag');
  const cleared=flagImage(flagged,false);
  assert.deepEqual(cleared.tags,['FF625']);
  assert.deepEqual(cleared.reviews,flagged.reviews);
});

test('a card that already has 30 tags is refused instead of becoming invalid',()=>{
  const card={...studied(),tags:Array.from({length:30},(_,i)=>'t'+i)};
  assert.throws(()=>flagImage(card,true),/태그가 30개/);
});

test('the picture–word and picture–sentence marks are separate and can both be set',()=>{
  const card=studied(),both=setFlag(setFlag(card,'word',true),'sentence',true);
  assert.deepEqual(both.tags,['FF625',flagKinds.word.tag,flagKinds.sentence.tag]);
  assert.deepEqual(both.schedule,card.schedule);
  assert.deepEqual(both.reviews,card.reviews);
  const onlySentence=setFlag(both,'word',false);
  assert.equal(hasFlag(onlySentence,'word'),false);
  assert.equal(hasFlag(onlySentence,'sentence'),true);
  assert.equal(model.parseLibrary(JSON.stringify({...model.newLibrary(),cards:[both]})).cards.length,1);
});

test('a card without a picture can be marked as needing one, with its own tag',()=>{
  const start=new Date('2026-11-01T09:00:00Z');
  const bare=model.rateCard(model.newCard({type:'basic',deck:'Oxford 3000 · B2',front:'She is ___ of lying.',answer:'suspect',tags:['OX3000']},start),3,start);
  const marked=setFlag(bare,'missing',true);
  assert.deepEqual(marked.tags,['OX3000',flagKinds.missing.tag]);
  assert.equal(hasFlag(marked,'missing'),true);
  assert.equal(hasFlag(marked,'word'),false,'it is a mark of its own, not a picture-does-not-fit mark');
  assert.deepEqual(marked.reviews,bare.reviews);
  assert.deepEqual(setFlag(marked,'missing',false).tags,['OX3000']);
});

test('a word to remember is a mark like the others, and writing its memory swaps it for MY-LINK',async()=>{
  const m=await import('../static/saymore/cards/image-flag.mjs');
  const card={tags:['OX3000','A1'],schedule:{due:'x'},reviews:[{rating:1}]};
  const marked=m.setFlag(card,'remember',true);
  assert.equal(m.hasFlag(marked,'remember'),true);
  assert.deepEqual(marked.reviews,card.reviews);
  assert.deepEqual(m.memoryTags(marked),['OX3000','A1','MY-LINK']);
  assert.deepEqual(m.memoryTags({tags:['MY-LINK','REMEMBER']}),['MY-LINK']);
  assert.equal(m.memoryQuestion('dog'),'What does dog remind you of?');
  assert.equal(m.hasHangul('my dog Coco'),false);assert.equal(m.hasHangul('우리 집 dog'),true);
  assert.ok(!('remember' in m.pictureMark));
});
