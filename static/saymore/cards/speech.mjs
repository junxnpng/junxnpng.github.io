// macOS lists novelty and legacy robot voices (Albert, Bad News, Fred…) before the natural ones,
// so "first en-US voice" picks a voice that distorts pronunciation. Rank by name instead.
const natural=['Samantha','Ava','Allison','Evan','Nicky','Joelle','Noelle','Susan','Tom','Zoe','Alex','Google US English','Microsoft Aria','Microsoft Jenny','Microsoft Guy','Microsoft Ava','Microsoft Andrew','Microsoft Emma'];
const distorted=/^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/;
function voiceRank(voice){
  const name=voice.name||'';
  const index=natural.findIndex(n=>name.startsWith(n));
  const tier=index>=0?0:distorted.test(name)?2:1;
  const quality=/Premium|Enhanced|Natural|고품질|프리미엄/i.test(name)?0:1;
  return [tier,quality,voice.localService?0:1,index<0?natural.length:index];
}
export function usVoice(voices){
  return voices.filter(v=>/^en[-_]US$/i.test(v.lang))
    .map((voice,order)=>({voice,rank:[...voiceRank(voice),order]}))
    .sort((a,b)=>{for(let i=0;i<a.rank.length;i++)if(a.rank[i]!==b.rank[i])return a.rank[i]-b.rank[i];return 0;})[0]?.voice||null;
}
export function stopSpeech(){if(typeof window!=='undefined'&&window.speechSynthesis)window.speechSynthesis.cancel();}
export async function speakUS(text,status){
  const synth=window.speechSynthesis;
  if(!synth||!window.SpeechSynthesisUtterance){status('이 브라우저는 합성 음성을 지원하지 않아요');return;}
  let voice=usVoice(synth.getVoices());
  if(!voice){
    await new Promise(resolve=>{
      const finish=()=>{clearTimeout(timer);synth.removeEventListener('voiceschanged',finish);resolve();};
      const timer=setTimeout(finish,1500);synth.addEventListener('voiceschanged',finish,{once:true});
    });
    voice=usVoice(synth.getVoices());
  }
  if(!voice){status('미국식 음성이 없어요 · 기기의 영어(미국) 음성을 확인해 주세요');return;}
  stopSpeech();
  const utterance=new SpeechSynthesisUtterance(text);utterance.voice=voice;utterance.lang='en-US';utterance.rate=0.85;
  utterance.onstart=()=>status('미국식 합성 음성 재생 중…');
  utterance.onend=()=>status('▶ 미국식 기기 합성 음성');
  utterance.onerror=event=>status(['canceled','interrupted'].includes(event.error)?'▶ 미국식 기기 합성 음성':'음성을 재생하지 못했어요 · 다시 눌러주세요');
  synth.speak(utterance);
}
