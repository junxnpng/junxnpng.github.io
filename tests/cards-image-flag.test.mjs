import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../static/saymore/cards/model.mjs';
import {imageFlagTag,hasImageFlag,flagImage} from '../static/saymore/cards/image-flag.mjs';

const image={path:'media/00000000-0000-4000-8000-000000000001.jpg',credit:''};
const studied=()=>{
  const start=new Date('2026-11-01T09:00:00Z');
  let card=model.newCard({type:'picture',deck:'Fluent Forever · First 625',answer:'dog',tags:['FF625'],image},start);
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
