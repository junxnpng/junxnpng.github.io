export const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};

import {speakUS,stopSpeech} from './speech.mjs?v=2';

// Plain English answers ("dog", "street / road", "wake up") get a link to the Cambridge US entry, where
// the US speaker plays a dictionary recording. IPA cards and long answers are left alone.
export function dictionaryLinks(answer){
  const terms=String(answer||'').split(' / ').map(t=>t.trim());
  if(!terms.length||terms.length>3||terms.some(t=>!/^[A-Za-z][A-Za-z' -]{0,39}$/.test(t)||t.split(' ').length>4))return [];
  // Compound numbers and these phrasal verbs have no entry of their own; link their words instead.
  const numbers=new Set('one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion'.split(' '));
  const split=term=>{const words=term.toLowerCase().split(/[ -]/);return words.length>1&&(words.every(w=>numbers.has(w))||['pass by','wake up'].includes(term.toLowerCase()))?[...new Set(words)]:[term];};
  return terms.flatMap(split).map(term=>({term,url:'https://dictionary.cambridge.org/us/search/english/direct/?q='+encodeURIComponent(term.toLowerCase())}));
}

export function showCard(container, card, sources = {}, answer = false) {
  stopSpeech();
  const article=el('article',undefined,'study-card');
  const label=el('div',undefined,'study-card-label');
  label.append(el('span',card.type==='picture'?'그림 → 단어':'앞면 → 뒷면'),el('span',answer?'뒷면':'앞면'));
  article.append(label);
  if (sources.image) {
    const img=el('img',undefined,'study-image');img.alt='카드에 첨부한 학습 사진';img.src=sources.image;article.append(img);
  } else if (card.type==='picture') article.append(el('div','사진','image-placeholder'));
  const body=el('div',undefined,'study-body');
  if (answer) {
    body.append(el('p',card.answer||'단어 또는 정답','study-answer'));
    if(card.ipa)body.append(el('p',card.ipa,'study-ipa'));
    // A card with a recording offers both: the human recording and the device voice reading the same word.
    const listen=el('div',undefined,'study-listen');let audio=null;
    if(sources.audio){
      audio=el('audio');audio.src=sources.audio;audio.preload='metadata';
      const button=el('button',card.speech?'▶ 사람 녹음':'▶ 발음 듣기','secondary');button.type='button';
      button.addEventListener('click',async()=>{stopSpeech();try{audio.currentTime=0;await audio.play();}catch{button.textContent='재생할 수 없는 음성이에요';}});
      listen.append(button,audio);
    }
    if(card.speech){
      const button=el('button','▶ 미국식 기기 합성 음성','secondary');button.type='button';
      button.addEventListener('click',()=>{audio?.pause();speakUS(card.speech,message=>{button.textContent=message;});});
      listen.append(button);
    }
    if(listen.childElementCount)body.append(listen);
    if(card.speech)body.append(el('p',sources.audio?'왼쪽은 사람이 녹음한 소리, 오른쪽은 기기가 읽는 합성 음성이에요.':'녹음이 아닌 기기 합성 음성이에요.','study-credit'));
    const links=dictionaryLinks(card.answer);
    if(links.length){
      const line=el('p',undefined,'study-dictionary');line.append('Cambridge 사전에서 듣기: ');
      links.forEach(({term,url},i)=>{const link=el('a',`${term} ↗`);link.href=url;link.target='_blank';link.rel='noopener noreferrer';if(i)line.append(' · ');line.append(link);});
      body.append(line);
    }
    if(card.sentence)body.append(el('p',card.sentence,'study-sentence'));
    if(card.memory)body.append(el('p',card.memory,'study-memory'));
    if(card.audio?.credit)body.append(el('p',card.audio.credit,'study-credit'));
  } else body.append(el('p',card.front||(card.type==='picture'?'사진을 보고 영어로 말해보세요.':'질문 또는 힌트를 입력해주세요.'),'study-prompt'));
  if(card.image?.credit){
    if(answer)body.append(el('p',card.image.credit,'study-credit'));
    else{const credit=el('details',undefined,'study-credit');credit.append(el('summary','사진 출처'),el('p',card.image.credit));body.append(credit);}
  }
  article.append(body);container.replaceChildren(article);
}
