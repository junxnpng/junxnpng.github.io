import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {newCard,editCard,rateCard,copy} from '../static/saymore/cards/model.mjs';
let groups;
if(existsSync('static/saymore/cards/study-groups.mjs'))groups=await import('../static/saymore/cards/study-groups.mjs');
const now=new Date('2026-11-10T01:00:00Z');
const card=(answer,deck,tags=[])=>newCard({type:'basic',front:'Recall the word.',answer,deck,tags},now);

const dogId='01cac855-1800-58b9-94e8-4be5e45d7d62'; // "dog" in the first 625 deck: listed as A1 in levels.mjs

test('word cards are grouped by CEFR level only, followed by one IPA group',()=>{
  assert.ok(groups,'study group selection is not implemented');
  const a1=Array.from({length:230},(_,i)=>card(`a1 ${i+1}`,'Oxford 3000 · A1',['OX3000','A1']));
  const b2=Array.from({length:40},(_,i)=>card(`b2 ${i+1}`,'Oxford 3000 · B2',['OX3000','B2']));
  const dog={...card('dog','Fluent Forever · First 625',['FF625']),id:dogId};
  const number=card('twenty-one','Fluent Forever · First 625',['FF625']);
  const ipa=Array.from({length:67},(_,i)=>card(`sound ${i+1}`,'IPA 01 · 모음',['IPA']));
  const input=[dog,...a1.slice(0,50),...ipa,...b2,number,...a1.slice(50)],before=copy(input);
  const all=groups.studyGroups(input),keys=all.map(g=>g.key);
  assert.equal(keys.some(k=>k.startsWith('words:')),false);
  assert.deepEqual(keys,['all','level:A1','level:B2','level:등급 밖','ipa','listen']);
  const of=key=>all.find(g=>g.key===key).cards;
  assert.deepEqual(of('level:A1').map(c=>c.id),[dog,...a1].map(c=>c.id));
  assert.equal(of('level:A1')[0].answer,'dog');
  assert.deepEqual(of('level:B2').map(c=>c.id),b2.map(c=>c.id));
  assert.deepEqual(of('level:등급 밖').map(c=>c.answer),['twenty-one']);
  assert.equal(of('ipa').length,67);
  assert.deepEqual(input,before);
});

test('ratings, content edits and due order cannot move a word to another level or position',()=>{
  assert.ok(groups);
  const cards=Array.from({length:102},(_,i)=>card(`word ${i+1}`,'renamed deck',['OX3000','B1']));
  const dog={...card('dog','Fluent Forever · First 625',['FF625']),id:dogId};
  cards[0]=rateCard(cards[0],4,now);
  cards[100]=editCard(cards[100],{...cards[100],answer:'my correction'});
  const edited=editCard(rateCard(dog,1,now),{...dog,answer:'hound'});
  const input=[...cards,edited];
  assert.deepEqual(groups.cardsInGroup(input,'level:B1').map(c=>c.id),cards.map(c=>c.id));
  assert.deepEqual(groups.cardsInGroup(input,'level:A1').map(c=>c.id),[dogId]);
  assert.equal(groups.cardsInGroup(input,'level:A1')[0].reviews.length,1);
});

test('a level tag on a card overrides the listed level',()=>{
  const dog={...card('dog','Fluent Forever · First 625',['FF625','B2']),id:dogId};
  assert.deepEqual(groups.studyGroups([dog]).filter(g=>g.key.startsWith('level:')).map(g=>g.key),['level:B2']);
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
  assert.deepEqual(groups.studyQueue(cards,'level:등급 밖','practice',now).map(c=>c.answer),['other']);
  assert.deepEqual(groups.unseenFirst(groups.cardsInGroup(cards,'ipa')).map(c=>c.answer),['new','forgotten','known']);
  assert.deepEqual(groups.unseenFirst([]),[]);
  assert.deepEqual(cards,before);
});

test('all IPA cards share one group, personal decks are selectable, and an unknown group cannot fall back to all cards',()=>{
  assert.ok(groups);
  const vowel=card('vowel','IPA 01 · 모음',['IPA']);
  const consonant=card('consonant','IPA 02 · 자음',['IPA']);
  const custom=card('custom','My own deck');
  const cards=[vowel,consonant,custom];
  const options=groups.studyGroups(cards);
  const own=options.find(g=>g.label===custom.deck);
  assert.deepEqual(options.map(g=>g.key),['all','ipa',own.key,'listen']);
  assert.deepEqual(groups.cardsInGroup(cards,'ipa').map(c=>c.answer),['vowel','consonant']);
  assert.deepEqual(groups.cardsInGroup(cards,own.key).map(c=>c.answer),['custom']);
  assert.deepEqual(groups.studyQueue(cards,'words:99','due',now),[]);
  assert.deepEqual(groups.studyQueue(cards,'level:A1:1','due',now),[]);
});

test('progress partitions cards into due, reviewed today, and future without double counting repeats',()=>{
  assert.equal(typeof groups.studyProgress,'function');
  const localNow=new Date(2026,10,10,12),yesterday=new Date(2026,10,9,12);
  const fresh=newCard({type:'basic',front:'?',answer:'new'},yesterday);
  const done=rateCard(newCard({type:'basic',front:'?',answer:'done'},localNow),4,localNow);
  const unknown=rateCard(newCard({type:'basic',front:'?',answer:'unknown'},localNow),1,localNow);
  const repeated=rateCard(unknown,4,localNow,{retryUnknown:true});
  const waiting=rateCard(newCard({type:'basic',front:'?',answer:'waiting'},yesterday),4,yesterday);
  const input=[fresh,done,repeated,waiting],before=copy(input);
  assert.deepEqual(groups.studyProgress(input,localNow),{total:4,remaining:1,completedToday:2,waiting:1});
  assert.deepEqual(input,before);
});

test('progress uses the local calendar day and returns a card to remaining when it becomes due',()=>{
  assert.equal(typeof groups.studyProgress,'function');
  const beforeMidnight=new Date(2026,10,9,23,55),afterMidnight=new Date(2026,10,10,0,5);
  const c=rateCard(newCard({type:'basic',front:'?',answer:'forgotten'},beforeMidnight),1,beforeMidnight);
  assert.deepEqual(groups.studyProgress([c],afterMidnight),{total:1,remaining:0,completedToday:0,waiting:1});
  assert.deepEqual(groups.studyProgress([c],new Date(c.schedule.due)),{total:1,remaining:1,completedToday:0,waiting:0});
  assert.deepEqual(groups.studyProgress([],afterMidnight),{total:0,remaining:0,completedToday:0,waiting:0});
});

test('the card list can be ordered by creation or review time without changing the library',()=>{
  const at=d=>new Date(`2026-11-${d}T01:00:00Z`);
  const make=(answer,created)=>newCard({type:'basic',front:'Recall the word.',answer,deck:'내 덱'},at(created));
  const a=make('a','03'),b=make('b','01'),c=make('c','05'),d=make('d','01');
  const reviewedB=rateCard(b,3,at('06')),reviewedC=rateCard(c,4,at('07'));
  const input=[a,reviewedB,reviewedC,d],before=copy(input);
  const order=key=>groups.sortCards(input,key).map(x=>x.answer).join('');
  assert.equal(order('default'),'abcd');
  assert.equal(order('newest'),'cabd');
  assert.equal(order('oldest'),'bdac');
  assert.equal(order('reviewedNewest'),'cbad');
  assert.equal(order('reviewedOldest'),'bcad');
  assert.equal(order('dueSoonest'),'bcad');
  assert.equal(order('unknown-order'),'abcd');
  assert.deepEqual(input,before);
  assert.deepEqual(Object.keys(groups.sortOrders),['default','newest','oldest','reviewedNewest','reviewedOldest','dueSoonest']);
});

test('practice resumes at the remembered card, otherwise after what has already been studied',()=>{
  const list=['a','b','c','d'].map(x=>card(x,'내 덱'));
  assert.equal(groups.resumeIndex(list,list[2].id),2);
  assert.equal(groups.resumeIndex(list,list[0].id),0);
  assert.equal(groups.resumeIndex(list,undefined),0);
  const studied=[rateCard(list[0],3,now),rateCard(list[1],4,now),list[2],list[3]];
  assert.equal(groups.resumeIndex(studied,undefined),2);
  assert.equal(groups.resumeIndex(studied,'00000000-0000-4000-8000-000000000000'),2);
  assert.equal(groups.resumeIndex(studied,studied[3].id),3);
  assert.equal(groups.resumeIndex(studied.map(c=>c.reviews.length?c:rateCard(c,3,now)),undefined),0);
  assert.equal(groups.resumeIndex([],list[1].id),0);
});

test('word-form and word-order cards live in tabs of their own and never among the word cards',()=>{
  const word=card('dog','Oxford 3000 · A1',['OX3000','A1']),own=card('mine','My own deck');
  const form=card('went','Word forms',['FORM']),order=card('Do you speak English?','Word order',['ORDER']);
  const all=[word,form,own,order],before=copy(all);
  try{
    assert.equal(groups.setSection('nonsense'),'cards');
    const inCards=groups.studyGroups(all);
    assert.deepEqual(inCards.flatMap(g=>g.cards.map(c=>c.answer)).filter((a,i,list)=>list.indexOf(a)===i).sort(),['dog','mine']);
    assert.deepEqual(groups.cardsInGroup(all,'all').map(c=>c.answer),['dog','mine']);
    assert.deepEqual(groups.inSection(all).map(c=>c.answer),['dog','mine']);
    assert.deepEqual(groups.inSection(all,'order').map(c=>c.answer),['Do you speak English?']);
    assert.equal(groups.setSection('form'),'form');
    assert.deepEqual(groups.studyGroups(all).map(g=>[g.key,g.label,g.cards.map(c=>c.answer)]),[['all','단어 형태',['went']],['listen','발음 나중에 들을 카드',[]]]);
    assert.deepEqual(groups.studyQueue(all,'all','due',now).map(c=>c.answer),['went']);
    assert.deepEqual(groups.studyQueue(all,'level:A1','due',now),[]);
    assert.equal(groups.setSection('order'),'order');
    assert.deepEqual(groups.cardsInGroup(all,'all').map(c=>c.answer),['Do you speak English?']);
    assert.deepEqual(all,before);
  }finally{groups.setSection('cards');}
});

test('reviews that have come due go first, then every unseen card; there is no daily limit',()=>{
  groups.setSection('cards');
  const day=new Date(2026,10,10,12),earlier=new Date(2026,10,1,12);
  const make=answer=>newCard({type:'basic',deck:'IPA 01',front:'q',answer,tags:['IPA']},earlier);
  const longWait=rateCard(make('long wait'),3,earlier);                        // came due days ago
  const shortWait=rateCard(make('short wait'),3,new Date(2026,10,3,12));
  const metToday=rateCard(make('met today'),3,new Date(2026,10,10,9));        // answered today, next review ahead
  const fresh=Array.from({length:40},(_,i)=>make('new '+i));
  const cards=[fresh[0],shortWait,...fresh.slice(1),longWait,metToday],before=copy(cards);
  const queue=groups.studyQueue(cards,'all','due',day).map(c=>c.answer);
  assert.deepEqual(queue.slice(0,2),['long wait','short wait'],'due reviews first, longest wait first');
  assert.deepEqual(queue.slice(2),fresh.map(c=>c.answer),'then all unseen cards, in library order');
  assert.equal(queue.includes('met today'),false);
  assert.deepEqual(groups.studyProgress(cards,day),{total:43,remaining:42,completedToday:1,waiting:0});
  assert.deepEqual(cards,before);
});

test('안 본 카드만 shows only never-answered cards of the group, and a rated card leaves it',()=>{
  groups.setSection('cards');
  const day=new Date(2026,10,10,12),earlier=new Date(2026,10,1,12);
  const make=(answer,tags=['IPA'])=>newCard({type:'basic',deck:'IPA 01',front:'q',answer,tags},earlier);
  const due=rateCard(make('due'),3,earlier),fresh=[make('a'),make('b')],other=make('other',['FORM']);
  const cards=[due,fresh[0],other,fresh[1]];
  assert.deepEqual(groups.studyQueue(cards,'all','unseen',day).map(c=>c.answer),['a','b'],'no due card, no other tab');
  const rated=[due,rateCard(fresh[0],1,day),other,fresh[1]];
  assert.deepEqual(groups.studyQueue(rated,'all','unseen',day).map(c=>c.answer),['b']);
  assert.deepEqual(groups.studyQueue([due],'all','unseen',day),[]);
});

test('remaining is unseen plus due, whatever the due date of an unseen card says',()=>{
  const day=new Date(2026,10,10,12);
  const unseenLater={...newCard({type:'basic',front:'q',answer:'later'},day)};
  unseenLater.schedule={...unseenLater.schedule,due:new Date(2026,10,20).toISOString()};
  const waiting=rateCard(newCard({type:'basic',front:'q',answer:'waiting'},new Date(2026,10,9,12)),4,new Date(2026,10,9,12));
  assert.equal(groups.toDo(unseenLater,day),true);
  assert.equal(groups.toDo(waiting,day),false);
  assert.deepEqual(groups.studyProgress([unseenLater,waiting],day),{total:2,remaining:1,completedToday:0,waiting:1});
  assert.deepEqual(groups.studyQueue([unseenLater,waiting],'all','due',day).map(c=>c.answer),['later']);
  assert.equal(groups.newCardsLeft,undefined,'the daily limit is gone');
});

test('the same list gives the same groups, and a list with one card changed gives fresh groups',()=>{
  groups.setSection('cards');
  const list=[card('dog','Oxford 3000 · A1',['OX3000','A1']),card('mine','My own deck')];
  const first=groups.studyGroups(list);
  assert.equal(groups.studyGroups(list),first);
  const changed=[list[0],editCard(list[1],{...list[1],deck:'Renamed deck'})];
  const fresh=groups.studyGroups(changed);
  assert.notEqual(fresh,first);
  assert.ok(fresh.some(g=>g.label==='Renamed deck'));
  assert.equal(first.some(g=>g.label==='Renamed deck'),false);
});

test('switching tabs never returns the groups remembered for the other tab',()=>{
  const list=[card('dog','Oxford 3000 · A1',['OX3000','A1']),card('went','Word forms',['FORM'])];
  try{
    groups.setSection('cards');
    const words=groups.studyGroups(list);
    groups.setSection('form');
    assert.deepEqual(groups.studyGroups(list).map(g=>g.cards.map(c=>c.answer)),[['went'],[]]);
    groups.setSection('cards');
    assert.deepEqual(groups.studyGroups(list),words);
    assert.deepEqual(groups.cardsInGroup(list,'all').map(c=>c.answer),['dog']);
  }finally{groups.setSection('cards');}
});

test('the first answer of each word card gives the level summary and the first-weak group',()=>{
  const a1=Array.from({length:6},(_,i)=>card(`a ${i}`,'Oxford 3000 · A1',['OX3000','A1']));
  const b1=card('b','Oxford 3000 · B1',['OX3000','B1']),ipa=rateCard(card('sound','IPA 01 · 모음',['IPA']),1,now);
  const form=rateCard(card('went','Sentence · Word forms',['FORM']),1,now);
  const later=new Date(now.getTime()+3*864e5);
  a1[0]=rateCard(a1[0],1,now);a1[1]=rateCard(rateCard(a1[1],2,now),4,later,{early:true});a1[2]=rateCard(a1[2],3,now);a1[3]=rateCard(rateCard(a1[3],4,now),1,later,{early:true});
  const input=[...a1,b1,ipa,form];
  const rows=groups.levelSummary(input);
  assert.deepEqual(rows.map(r=>r.label),['A1','B1','합계']);
  assert.deepEqual(rows[0],{label:'A1',total:6,seen:4,first:[1,1,1,1]});
  assert.deepEqual(rows[2],{label:'합계',total:7,seen:4,first:[1,1,1,1]});
  assert.deepEqual(groups.cardsInGroup(input,'first-weak').map(c=>c.answer),['a 0','a 1']);
  assert.equal(groups.studyGroups([b1]).some(g=>g.key==='first-weak'),false);
});

test('cards marked to hear later form a group of their own in every tab, listed even when empty',()=>{
  const plain=card('cat','Mine'),marked=card('dog','Mine',['LISTEN-LATER']),form=card('ran','Mine',['FORM','LISTEN-LATER']);
  groups.setSection('cards');
  const list=[plain,marked,form];
  assert.deepEqual(groups.cardsInGroup(list,'listen').map(c=>c.answer),['dog']);
  assert.deepEqual(groups.cardsInGroup([plain],'listen'),[]);
  assert.ok(groups.studyGroups([plain]).some(g=>g.key==='listen'));
  groups.setSection('form');
  assert.deepEqual(groups.cardsInGroup([...list],'listen').map(c=>c.answer),['ran']);
  groups.setSection('cards');
});
