import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../static/saymore/cards/model.mjs';
const {newLibrary,newCard,editCard,rateCard,reviewOptions,dueCards,unknownCards,parseLibrary,renderNote}=model;
import {fsrs,generatorParameters} from '../static/saymore/cards/vendor/ts-fsrs.mjs';

const now = new Date('2026-11-08T12:00:00Z');
const fields = {type:'basic', deck:'첫 100단어', front:'A drink made from roasted beans', answer:'coffee', tags:'food morning'};
const oldParams=generatorParameters({request_retention:0.9,enable_fuzz:false});
const oldScheduler=fsrs(oldParams);
const legacyMetadata={name:'FSRS-6',implementation:'ts-fsrs',version:'5.4.2',params:oldParams};

test('remembered answers schedule whole days for new, learning, and relearning cards',()=>{
  const first=newCard(fields,now);
  const oldReview=(card,rating,at)=>{
    const result=oldScheduler.next(card.schedule,at,rating);
    return {...card,schedule:JSON.parse(JSON.stringify(result.card)),reviews:[...card.reviews,{at:at.toISOString(),rating,due:result.card.due.toISOString(),log:JSON.parse(JSON.stringify(result.log))}]};
  };
  const learned=oldReview(first,3,now),mature=oldReview(first,4,now),forgotten=oldReview(mature,1,new Date(mature.schedule.due));
  for(const card of [first,learned,forgotten]){
    parseLibrary(JSON.stringify({...newLibrary(now),cards:[card]}));
    const at=new Date(card.schedule.due),options=reviewOptions(card,at);
    for(const rating of [2,3,4]){
      const days=(Date.parse(options[rating].due)-at.getTime())/86400000;
      assert.ok(days>=1&&Number.isInteger(days),`rating ${rating} must use days, got ${days}`);
      assert.equal(rateCard(card,rating,at).schedule.due,options[rating].due);
    }
  }
});

test('opening an old minute-step library upgrades only its settings and preserves all card records',()=>{
  const card=newCard(fields,now),result=oldScheduler.next(card.schedule,now,3);
  card.schedule=JSON.parse(JSON.stringify(result.card));
  card.reviews=[{at:now.toISOString(),rating:3,due:result.card.due.toISOString(),log:JSON.parse(JSON.stringify(result.log))}];
  const old={...newLibrary(now),scheduler:legacyMetadata,revision:7,cards:[card]};
  const loaded=parseLibrary(JSON.stringify(old));
  assert.deepEqual(loaded.cards,old.cards);
  assert.equal(loaded.id,old.id);assert.equal(loaded.revision,7);assert.equal(loaded.updatedAt,old.updatedAt);
  assert.equal(loaded.scheduler.params.enable_short_term,false);
  const at=new Date(card.schedule.due),updated=rateCard(loaded.cards[0],3,at);
  assert.equal(updated.reviews.length,2);assert.deepEqual(updated.reviews[0],card.reviews[0]);
  assert.ok(Date.parse(updated.schedule.due)-at.getTime()>=86400000);
  assert.deepEqual(parseLibrary(JSON.stringify(loaded)),loaded);
});

test('unsupported scheduling settings are still rejected instead of silently changed',()=>{
  const library={...newLibrary(now),scheduler:JSON.parse(JSON.stringify(legacyMetadata))};
  library.scheduler.params.request_retention=0.7;
  assert.throws(()=>parseLibrary(JSON.stringify(library)),/복습 설정/);
});

test('unknown cards can be revisited on demand and automatically become due in 24 hours',()=>{
  const card=rateCard(newCard(fields,now),1,now);
  const other=rateCard(newCard({...fields,deck:'다른 덱'},now),1,now);
  const known=rateCard(newCard(fields,now),3,now);
  const library={...newLibrary(now),cards:[card,other,known]};
  assert.equal(card.schedule.due,'2026-11-09T12:00:00.000Z');
  assert.equal(card.schedule.scheduled_days,1);
  assert.deepEqual(dueCards(library,now),[]);
  assert.deepEqual(unknownCards(parseLibrary(JSON.stringify(library)),fields.deck).map(c=>c.id),[card.id]);
  assert.deepEqual(dueCards(library,new Date('2026-11-09T11:59:59.000Z')),[]);
  assert.deepEqual(dueCards(library,new Date('2026-11-09T12:00:00.000Z')).map(c=>c.id),[card.id,other.id]);
  assert.match(renderNote(card),/모름/);
});

test('only an explicit unknown-card session can record an early review',()=>{
  const unknown=rateCard(newCard(fields,now),1,now),known=rateCard(newCard(fields,now),3,now);
  const later=new Date('2026-11-08T14:00:00Z');
  assert.throws(()=>rateCard(unknown,3,later),/아직 복습/);
  assert.throws(()=>rateCard(known,3,later,{retryUnknown:true}),/아직 복습/);
  assert.throws(()=>rateCard(unknown,3,new Date('2026-11-08T11:00:00Z'),{retryUnknown:true}),/아직 복습/);
  const passed=rateCard(unknown,3,later,{retryUnknown:true});
  assert.equal(passed.reviews.length,2);
  assert.deepEqual(passed.reviews[0],unknown.reviews[0]);
  assert.ok(Date.parse(passed.schedule.due)-later.getTime()>=86400000);
  assert.deepEqual(unknownCards({...newLibrary(now),cards:[passed]}),[]);
  assert.equal(unknown.reviews.length,1);
});

test('forgetting a mature card also gets a 24-hour deadline, matching the button preview',()=>{
  let card=newCard(fields,now);
  for(let i=0;i<5;i++)card=rateCard(card,4,new Date(card.schedule.due));
  const at=new Date(card.schedule.due),options=reviewOptions(card,at),forgotten=rateCard(card,1,at);
  assert.equal(Date.parse(forgotten.schedule.due)-at.getTime(),86400000);
  assert.equal(options[1].due,forgotten.schedule.due);
  assert.equal(forgotten.schedule.scheduled_days,1);
  assert.equal(forgotten.reviews.length,6);
});

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

test('correcting a mis-pressed answer equals having pressed the intended one',()=>{
  const fresh=newCard(fields,now);
  for(const [wrong,right] of [[4,2],[1,3],[3,1],[2,4]]){
    const fixed=model.correctLastReview(rateCard(fresh,wrong,now),right,new Date('2026-11-08T12:05:00Z'));
    const intended=rateCard(fresh,right,now);
    assert.deepEqual(fixed.schedule,intended.schedule);
    assert.equal(fixed.reviews.length,1);
    assert.equal(fixed.reviews[0].rating,right);
    assert.equal(fixed.reviews[0].at,intended.reviews[0].at);
    assert.equal(fixed.reviews[0].due,intended.reviews[0].due);
    assert.equal(fixed.reviews[0].correctedFrom,wrong);
    parseLibrary(JSON.stringify({...newLibrary(now),cards:[fixed]}));
  }
});

test('only the last review changes when a later answer is corrected, and earlier history is kept',()=>{
  const first=rateCard(newCard(fields,now),3,now);
  const second=new Date(first.schedule.due);
  const wrong=rateCard(first,4,second), intended=rateCard(first,1,second);
  const fixed=model.correctLastReview(wrong,1);
  assert.deepEqual(fixed.schedule,intended.schedule);
  assert.deepEqual(fixed.reviews[0],first.reviews[0]);
  assert.equal(fixed.reviews[1].rating,1);
  assert.equal(Date.parse(fixed.schedule.due)-second.getTime(),86400000);
  assert.deepEqual(unknownCards({cards:[fixed]}).map(c=>c.id),[fixed.id]);
  // Correcting twice keeps the originally pressed answer for the record.
  assert.equal(model.correctLastReview(fixed,2).reviews[1].correctedFrom,4);
  parseLibrary(JSON.stringify({...newLibrary(now),cards:[fixed]}));
});

test('choosing the same answer changes nothing and cards without reviews cannot be corrected',()=>{
  const rated=rateCard(newCard(fields,now),3,now);
  assert.deepEqual(model.correctLastReview(rated,3),rated);
  assert.throws(()=>model.correctLastReview(newCard(fields,now),2));
  assert.throws(()=>model.correctLastReview(rated,5));
});

test('due review shows never-studied cards first, then the longest-waiting answers before recent ones',()=>{
  const at=d=>new Date(`2026-11-${d}T12:00:00Z`);
  const make=answer=>newCard({...fields,answer},at('01'));
  const fresh1=make('fresh1'),fresh2=make('fresh2');
  const oldest=rateCard(make('oldest'),4,at('02'));     // answered 2 Nov, due 10 Nov
  const middle=rateCard(make('middle'),3,at('07'));     // answered 7 Nov, due 10 Nov
  const recent=rateCard(make('recent'),2,at('08'));     // answered 8 Nov, due 10 Nov
  const notYet=rateCard(make('notYet'),4,at('09'));     // due 17 Nov
  const library={...newLibrary(at('01')),cards:[recent,fresh1,notYet,oldest,fresh2,middle]};
  const before=JSON.stringify(library);
  assert.deepEqual(dueCards(library,at('11')).map(c=>c.answer),['fresh1','fresh2','oldest','middle','recent']);
  assert.equal(JSON.stringify(library),before);
});

test('how long a studied card waited past its date is derived from the history, not stored',()=>{
  const at=(d,h='12')=>new Date(`2026-11-${d}T${h}:00:00Z`);
  const first=rateCard(newCard(fields,at('01')),3,at('01'));          // due 4 Nov
  assert.equal(model.overdueMs(newCard(fields,at('01')),at('20')),0);  // never studied: nothing is overdue
  assert.equal(model.overdueMs(first,at('03')),0);
  assert.equal(model.waitLabel(model.overdueMs(first,at('04','17'))),'5시간');
  assert.equal(model.waitLabel(model.overdueMs(first,at('09'))),'5일');
  assert.equal(model.waitLabel(30*60000),'');
  const late=rateCard(first,3,at('09'));
  assert.equal(model.waitLabel(model.reviewLateMs(late,1)),'5일');
  assert.equal(model.reviewLateMs(late,0),0);
  assert.deepEqual(Object.keys(late.reviews[1]).sort(),['at','due','log','rating']);
  assert.match(renderNote(late),/예정일보다 5일 늦게/);
  const onTime=rateCard(first,3,new Date(first.schedule.due));
  assert.equal(model.reviewLateMs(onTime,1),0);
});
