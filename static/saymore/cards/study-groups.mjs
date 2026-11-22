import {dueCards,unknownCards} from './model.mjs?v=9';
import {levels,cardLevel} from './levels.mjs?v=1';
import {flagKinds} from './image-flag.mjs?v=6';

const isWord=card=>card.tags.includes('FF625')||card.tags.includes('OX3000')||card.deck==='Fluent Forever · First 625';
const unlevelled='등급 밖';
// Word-form cards, word-order cards and work-English cards each have a tab of their own and never appear among
// the word cards. The page says which tab it is showing; every list below is limited to that one.
export const sections={form:{tag:'FORM',label:'단어 형태'},order:{tag:'ORDER',label:'문장 어순'},work:{tag:'KVC',label:'업무 영어'}};
let section='cards';
export function setSection(value){section=Object.hasOwn(sections,value)?value:'cards';return section;}
const sectionOf=card=>Object.keys(sections).find(name=>card.tags.includes(sections[name].tag))||'cards';
export const inSection=(cards,name=section)=>cards.filter(card=>sectionOf(card)===name);
const isIpa=card=>!isWord(card)&&(card.tags.includes('IPA')||/^IPA(?:\s|$)/i.test(card.deck));

// The groups of one list of cards are asked for many times while a screen is drawn. The list is replaced,
// never changed in place, whenever a card changes, so the answer can be kept for as long as the list lives.
const grouped=new WeakMap();
export function studyGroups(every){
  const kept=grouped.get(every);
  if(kept?.section===section)return kept.groups;
  const groups=buildGroups(every);
  if(every&&typeof every==='object')grouped.set(every,{section,groups});
  return groups;
}
function buildGroups(every){
  const cards=inSection(every);
  // Cards marked during review to hear again later. Listed even when empty, so taking the mark off the last
  // one does not move a review going on in this group to another group.
  const listen={key:'listen',label:flagKinds.listen.list,section:'표시',cards:cards.filter(c=>c.tags.includes(flagKinds.listen.tag))};
  if(section!=='cards'){
    // A tab whose cards come in more than one deck also lists each deck, so one part can be studied before the rest.
    const decks=[...new Set(cards.map(c=>c.deck))].sort((a,b)=>a.localeCompare(b));
    const parts=decks.length>1?decks.map(deck=>({key:`deck:${deck}`,label:deck,section:'묶음',cards:cards.filter(c=>c.deck===deck)})):[];
    return [{key:'all',label:sections[section].label,section:'전체',cards},...parts,listen];
  }
  const groups=[{key:'all',label:'전체 카드',section:'전체',cards}];
  const ipa=cards.filter(isIpa),words=cards.filter(isWord);
  // One group per CEFR level, in library order, which ratings and edits keep.
  for(const level of [...levels,unlevelled]){
    const list=words.filter(c=>(cardLevel(c)||unlevelled)===level);
    if(list.length)groups.push({key:`level:${level}`,label:level===unlevelled?'등급 밖 (숫자·문법 용어 등)':level,section:'단어',cards:list});
  }
  const weak=words.filter(firstWeak);
  if(weak.length)groups.push({key:'first-weak',label:'처음에 모름·어려움',section:'단어',cards:weak});
  if(ipa.length)groups.push({key:'ipa',label:'IPA',section:'IPA',cards:ipa});
  const own=cards.filter(c=>!isIpa(c)&&!isWord(c));
  for(const deck of [...new Set(own.map(c=>c.deck))].sort())groups.push({key:`deck:${deck}`,label:deck,section:'내 덱',cards:own.filter(c=>c.deck===deck)});
  groups.push(listen);
  return groups;
}

// A word counts as "not known at first" by its first answer: 모름 or 어려움. If that first answer was
// corrected, the corrected rating counts. Nothing is stored for this; it is read from the review history each time.
export const firstWeak=card=>[1,2].includes(card.reviews[0]?.rating);

// How the word cards of each level were answered the first time they were seen: one row a level,
// then the words outside the levels, then all of them. IPA, word-form and word-order cards are left out.
export function levelSummary(every){
  const words=inSection(every,'cards').filter(isWord);
  const row=(label,list)=>{
    const first=[0,0,0,0];
    for(const c of list){const r=c.reviews[0]?.rating;if(r>=1&&r<=4)first[r-1]++;}
    return {label,total:list.length,seen:list.filter(c=>c.reviews.length).length,first};
  };
  const rows=[...levels,unlevelled].map(level=>row(level,words.filter(c=>(cardLevel(c)||unlevelled)===level))).filter(r=>r.total);
  return rows.length?[...rows,row('합계',words)]:[];
}

// Practice order: cards never reviewed first, then the rest; each part keeps the library order.
export function unseenFirst(cards){return [...cards.filter(c=>!c.reviews.length),...cards.filter(c=>c.reviews.length)];}

export function cardsInGroup(cards,key){return studyGroups(cards).find(group=>group.key===key)?.cards||[];}

// What is left to do: every card never seen, and every seen card whose review has come due.
// There is no daily limit on new cards; instead the reviews that have come due go first (longest wait
// first), so thousands of unseen cards never stand in front of them. Unseen cards follow in library order.
const unseen=card=>card.schedule.state===0;
export const toDo=(card,now=new Date())=>unseen(card)||Date.parse(card.schedule.due)<=now.getTime();

// The order of 오늘 복습. Either way the same cards are in it; only which part comes first differs.
export const reviewOrders={dueFirst:'복습할 카드 먼저',unseenFirst:'안 본 카드 먼저'};
export function studyQueue(cards,key,mode='due',now=new Date(),order='dueFirst'){
  const selected=cardsInGroup(cards,key);
  if(mode==='practice')return selected;
  if(mode==='unknown')return unknownCards({cards:selected});
  // 안 본 카드만: only cards never answered, in library order; once rated a card leaves this list.
  if(mode==='unseen')return selected.filter(unseen);
  const due=dueCards({cards:selected},now).filter(c=>!unseen(c)),fresh=selected.filter(unseen);
  return order==='unseenFirst'?[...fresh,...due]:[...due,...fresh];
}

// remaining: cards to do now (toDo); completedToday: the others answered today; waiting: seen cards whose
// next review is still ahead.
export function studyProgress(cards,now=new Date()){
  const start=new Date(now);start.setHours(0,0,0,0);
  let remaining=0,completedToday=0;
  for(const card of cards){
    if(toDo(card,now)){remaining++;continue;}
    const reviewed=Date.parse(card.reviews.at(-1)?.at);
    if(reviewed>=start.getTime()&&reviewed<=now.getTime())completedToday++;
  }
  return {total:cards.length,remaining,completedToday,waiting:cards.length-remaining-completedToday};
}

export const sortOrders={default:'기본 순서',unseenFirst:'안 본 카드 먼저',newest:'최근에 만든 순',oldest:'오래전에 만든 순',reviewedNewest:'최근에 복습한 순',reviewedOldest:'오래전에 복습한 순',dueSoonest:'복습 예정일 빠른 순'};
// Stable: ties keep the library order. Cards never reviewed go last in the review-based orders, and first
// in 안 본 카드 먼저 (never reviewed as in the review: no rating yet).
export function sortCards(cards,order='default'){
  if(order==='unseenFirst')return [...cards.filter(unseen),...cards.filter(c=>!unseen(c))];
  const created=c=>Date.parse(c.createdAt),reviewed=c=>c.reviews.length?Date.parse(c.reviews.at(-1).at):null,due=c=>c.reviews.length?Date.parse(c.schedule.due):null;
  const by=(key,direction)=>(a,b)=>{const x=key(a),y=key(b);return x===null?(y===null?0:1):y===null?-1:direction*(x-y);};
  const compare={newest:by(created,-1),oldest:by(created,1),reviewedNewest:by(reviewed,-1),reviewedOldest:by(reviewed,1),dueSoonest:by(due,1)}[order];
  return compare?[...cards].sort(compare):cards;
}

// Where "이어서 연습" starts: the card last shown in this group. With no remembered card (first use,
// another device, or the card is gone) it continues after what has been studied: the first card
// that has never been reviewed, or the start when every card has been.
export function resumeIndex(cards,savedId){
  const saved=savedId?cards.findIndex(c=>c.id===savedId):-1;
  if(saved>=0)return saved;
  const fresh=cards.findIndex(c=>!c.reviews.length);
  return fresh<0?0:fresh;
}
