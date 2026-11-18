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
  const known=rateCard(newCard(fields,now),4,now);                       // 쉬움: four days
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
  const oldest=rateCard(make('oldest'),4,at('02'));     // answered 2 Nov, due 6 Nov
  const middle=rateCard(make('middle'),3,at('07'));     // answered 7 Nov, due 8 Nov
  const recent=rateCard(make('recent'),2,at('08'));     // answered 8 Nov, due 9 Nov
  const notYet=rateCard(make('notYet'),4,at('09'));     // due 13 Nov
  const library={...newLibrary(at('01')),cards:[recent,fresh1,notYet,oldest,fresh2,middle]};
  const before=JSON.stringify(library);
  assert.deepEqual(dueCards(library,at('11')).map(c=>c.answer),['fresh1','fresh2','oldest','middle','recent']);
  assert.equal(JSON.stringify(library),before);
});

test('how long a studied card waited past its date is derived from the history, not stored',()=>{
  const at=(d,h='12')=>new Date(`2026-11-${d}T${h}:00:00Z`);
  const first=rateCard(newCard(fields,at('01')),4,at('01'));          // due 5 Nov
  assert.equal(model.overdueMs(newCard(fields,at('01')),at('20')),0);  // never studied: nothing is overdue
  assert.equal(model.overdueMs(first,at('04')),0);
  assert.equal(model.waitLabel(model.overdueMs(first,at('05','17'))),'5시간');
  assert.equal(model.waitLabel(model.overdueMs(first,at('10'))),'5일');
  assert.equal(model.waitLabel(30*60000),'');
  const late=rateCard(first,3,at('10'));
  assert.equal(model.waitLabel(model.reviewLateMs(late,1)),'5일');
  assert.equal(model.reviewLateMs(late,0),0);
  assert.deepEqual(Object.keys(late.reviews[1]).sort(),['at','due','log','rating']);
  assert.match(renderNote(late),/예정일보다 5일 늦게/);
  const onTime=rateCard(first,3,new Date(first.schedule.due));
  assert.equal(model.reviewLateMs(onTime,1),0);
});

test('practice can record an answer before the due date, and it schedules from that moment',()=>{
  const first=rateCard(newCard(fields,now),4,now);                       // due in 4 days
  const early=new Date(now.getTime()+2*86400000);
  assert.throws(()=>rateCard(first,3,early),/아직 복습할 때가 아니에요/);
  const answered=rateCard(first,3,early,{early:true});
  assert.equal(answered.reviews.length,2);
  assert.equal(answered.reviews[1].at,early.toISOString());
  assert.ok(Date.parse(answered.schedule.due)>early.getTime());
  assert.equal(model.reviewLateMs(answered,1),0);
  parseLibrary(JSON.stringify({...newLibrary(now),cards:[answered]}));
  // A mis-pressed early answer can be corrected like any other.
  assert.equal(model.correctLastReview(answered,1).reviews[1].rating,1);
});

test('a practice answer on a device whose clock is behind the last answer is still recorded',()=>{
  const first=rateCard(newCard(fields,now),3,new Date('2026-11-09T00:10:00Z'));
  const behind=new Date('2026-11-09T00:08:00Z');                       // two minutes before that answer
  assert.doesNotThrow(()=>reviewOptions(first,behind));
  const again=rateCard(first,3,behind,{early:true});
  assert.equal(again.reviews.length,2);
  assert.equal(again.reviews[1].at,first.reviews[0].at,'recorded at the last answer\'s time, never before it');
  assert.ok(Date.parse(again.schedule.due)>Date.parse(again.reviews[1].at));
});

test('a date label is the same each time for one instant and differs for another',()=>{
  const at='2026-11-08T12:34:00Z';
  assert.equal(model.dateLabel(at),model.dateLabel(new Date(at)));
  assert.equal(model.dateLabel(at),model.dateLabel(at));
  assert.notEqual(model.dateLabel(at),model.dateLabel('2026-11-09T12:34:00Z'));
  assert.notEqual(model.dateLabel(at),model.dateLabel('2026-11-08T12:35:00Z'));
});

test('a card may carry a second recording of the example word, and keeps it through answers and edits',()=>{
  const sound={path:'media/00000000-0000-4000-8000-00000000000a.mp3',credit:'symbol demo'};
  const word={path:'media/00000000-0000-4000-8000-00000000000b.mp3',credit:'word · CC BY-SA'};
  const card=newCard({...fields,audio:sound,wordAudio:word},now);
  assert.deepEqual(card.wordAudio,word);
  assert.deepEqual(model.attachmentPaths(card),[sound.path,word.path]);
  const library={...newLibrary(now),cards:[card]};
  assert.deepEqual(parseLibrary(JSON.stringify(library)).cards[0].wordAudio,word,'a library holding it reads back');
  const rated=rateCard(card,3,now);
  assert.deepEqual(rated.wordAudio,word);
  // The editor knows nothing of the second recording; saving its fields must not drop it.
  const {wordAudio,...fromEditor}=rated;
  assert.deepEqual(editCard(rated,{...fromEditor,memory:'note'}).wordAudio,word);
  assert.match(renderNote(rated),/단어 녹음/);
  assert.equal('wordAudio' in newCard(fields,now),false,'cards without one stay as they were');
  assert.throws(()=>newCard({...fields,wordAudio:{path:'media/00000000-0000-4000-8000-00000000000b.png',credit:'x'}},now));
});

// Anki's default scheduler (SM-2), as the cards now use it.
const days=(card,at)=>(Date.parse(card.schedule.due)-at.getTime())/86400000;
const gaps=card=>card.reviews.map(r=>(Date.parse(r.due)-Date.parse(r.at))/86400000);
const onTime=(card,rating)=>rateCard(card,rating,new Date(card.schedule.due));

test('a new card comes back in 1 day (어려움·알맞음) or 4 days (쉬움), and 모름 within 24 hours',()=>{
  const card=newCard(fields,now),options=reviewOptions(card,now);
  assert.deepEqual([1,2,3,4].map(r=>(Date.parse(options[r].due)-now.getTime())/86400000),[1,1,1,4]);
  for(const r of [1,2,3,4])assert.equal(rateCard(card,r,now).schedule.due,options[r].due);
});

test('answering 알맞음 on time grows the gap by the ease of 2.5: 1, 3, 8, 20, 50, 125 days',()=>{
  let card=newCard(fields,now);card=rateCard(card,3,now);
  for(let i=0;i<5;i++)card=onTime(card,3);
  assert.deepEqual(gaps(card),[1,3,8,20,50,125]);
  assert.equal(model.cardEase(card.reviews),2.5);
  parseLibrary(JSON.stringify({...newLibrary(now),cards:[card]}));
});

test('on a card in review 어려움 < 알맞음 < 쉬움, and the ease moves with each answer',()=>{
  let card=onTime(rateCard(newCard(fields,now),3,now),3);              // gap 3, ease 2.5
  const at=new Date(card.schedule.due),o=reviewOptions(card,at);
  assert.deepEqual([2,3,4].map(r=>(Date.parse(o[r].due)-at.getTime())/86400000),[4,8,10]); // 3×1.2→4 (≥gap+1), 3×2.5→8, 3×2.5×1.3→10
  const hard=rateCard(card,2,at),easy=rateCard(card,4,at);
  assert.equal(model.cardEase(hard.reviews),2.35);
  assert.equal(model.cardEase(easy.reviews),2.65);
  // The ease never falls below 1.3.
  let low=card;for(let i=0;i<20;i++)low=onTime(low,2);
  assert.equal(model.cardEase(low.reviews),1.3);
});

test('a late answer counts half the extra days for 알맞음 and all of them for 쉬움',()=>{
  const card=onTime(rateCard(newCard(fields,now),3,now),3);            // gap 3
  const at=new Date(Date.parse(card.schedule.due)+4*86400000),o=reviewOptions(card,at);
  assert.deepEqual([2,3,4].map(r=>(Date.parse(o[r].due)-at.getTime())/86400000),[4,13,23]); // (3+2)×2.5=12.5→13, (3+4)×2.5×1.3=22.75→23
});

test('forgetting lowers the ease by 0.2 and starts the gaps again from one day',()=>{
  let card=onTime(onTime(rateCard(newCard(fields,now),3,now),3),3);  // gaps 1,3,8
  const forgot=onTime(card,1);
  assert.equal(days(forgot,new Date(forgot.reviews.at(-1).at)),1);
  assert.equal(model.cardEase(forgot.reviews),2.3);
  const at=new Date(forgot.schedule.due),o=reviewOptions(forgot,at);
  assert.deepEqual([2,3,4].map(r=>(Date.parse(o[r].due)-at.getTime())/86400000),[1,1,2]);
  // Forgetting it again while relearning does not lower the ease a second time.
  assert.equal(model.cardEase(onTime(forgot,1).reviews),2.3);
  const back=onTime(onTime(forgot,3),3);                              // relearned: 1 day, then 1×2.3 lifted above 어려움's 2
  assert.deepEqual(gaps(back).slice(-2),[1,3]);
});

test('a card scheduled by the old FSRS settings keeps its date and continues from that gap',()=>{
  const old=card=>{const at=new Date(card.reviews.at(-1)?.due??now),result=oldScheduler.next(card.schedule,at,3);
    return {...card,schedule:JSON.parse(JSON.stringify(result.card)),reviews:[...card.reviews,{at:at.toISOString(),rating:3,due:result.card.due.toISOString(),log:JSON.parse(JSON.stringify(result.log))}]};};
  let card=newCard(fields,now);for(let i=0;i<5;i++)card=old(card);
  const loaded=parseLibrary(JSON.stringify({...newLibrary(now),scheduler:legacyMetadata,cards:[card]})).cards[0];
  assert.deepEqual(loaded.schedule,card.schedule);
  const gap=gaps(card).at(-1),at=new Date(card.schedule.due);
  assert.ok(gap>20,`old gap ${gap}`);
  const next=rateCard(loaded,3,at);
  assert.equal(days(next,at),Math.round(Math.round(gap)*2.5));
  assert.deepEqual(next.reviews.slice(0,-1),card.reviews);
});

test('practice before the date follows Anki early review: never shrinks 알맞음, grows from days waited',()=>{
  const card=onTime(onTime(rateCard(newCard(fields,now),3,now),3),3);  // gap 8, answered at its date
  const last=Date.parse(card.reviews.at(-1).at);
  const sameDay=new Date(last+3600000),o=reviewOptions(card,sameDay);
  assert.deepEqual([2,3,4].map(r=>(Date.parse(o[r].due)-sameDay.getTime())/86400000),[5,8,9]); // 8×0.6→5, 8, 8×1.15→9
  const fiveDays=new Date(last+5*86400000),p=reviewOptions(card,fiveDays);
  assert.deepEqual([2,3,4].map(r=>(Date.parse(p[r].due)-fiveDays.getTime())/86400000),[6,13,14]); // 5×1.2, 5×2.5=12.5→13, ×1.15→14
  const answered=rateCard(card,3,fiveDays,{early:true});
  assert.equal(answered.schedule.due,p[3].due);
  assert.equal(model.cardEase(answered.reviews),2.5);
  assert.equal(model.cardEase(rateCard(card,2,fiveDays,{early:true}).reviews),2.35);
});

test('correcting the last answer gives the same date as pressing the intended button',()=>{
  const card=onTime(onTime(rateCard(newCard(fields,now),3,now),3),3);
  const at=new Date(card.schedule.due);
  for(const [pressed,meant] of [[2,3],[3,4],[1,3],[4,1],[3,2]]){
    const fixed=model.correctLastReview(rateCard(card,pressed,at),meant),right=rateCard(card,meant,at);
    assert.equal(fixed.schedule.due,right.schedule.due);
    assert.equal(fixed.reviews.at(-1).due,right.reviews.at(-1).due);
    assert.equal(fixed.schedule.reps,right.schedule.reps);
    assert.equal(model.cardEase(fixed.reviews),model.cardEase(right.reviews));
    parseLibrary(JSON.stringify({...newLibrary(now),cards:[fixed]}));
  }
  const early=new Date(Date.parse(card.reviews.at(-1).at)+2*86400000);
  assert.equal(model.correctLastReview(rateCard(card,2,early,{early:true}),3).schedule.due,rateCard(card,3,early,{early:true}).schedule.due);
});

test('gaps stop at 36,500 days',()=>{
  let card=rateCard(newCard(fields,now),4,now);
  for(let i=0;i<12;i++)card=onTime(card,4);
  assert.equal(gaps(card).at(-1),36500);
});

test('a new card that was only ever 모름 is still learning: 쉬움 then gives 4 days, not the relearning 2',()=>{
  const once=rateCard(newCard(fields,now),1,now),at=new Date(once.schedule.due);
  assert.equal(days(rateCard(once,4,at),at),4);
  const twice=onTime(once,1),at2=new Date(twice.schedule.due);
  assert.equal(days(rateCard(twice,4,at2),at2),4);
});

test('an old card last given a minute step is still learning, however late it is answered',()=>{
  const minute=oldScheduler.next(newCard(fields,now).schedule,now,3);
  const card={...newCard(fields,now),schedule:JSON.parse(JSON.stringify(minute.card)),reviews:[{at:now.toISOString(),rating:3,due:minute.card.due.toISOString(),log:JSON.parse(JSON.stringify(minute.log))}]};
  assert.ok(Date.parse(card.schedule.due)-now.getTime()<86400000);
  const late=new Date(now.getTime()+30*86400000);
  assert.equal(days(rateCard(card,3,late),late),1);
  assert.equal(days(rateCard(card,4,late),late),4);
});
