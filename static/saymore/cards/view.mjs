export const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};

import {speakUS,stopSpeech} from './speech.mjs?v=2';

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
