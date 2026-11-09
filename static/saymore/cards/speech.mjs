export function usVoice(voices){
  return voices.filter(v=>/^en[-_]US$/i.test(v.lang)).sort((a,b)=>Number(b.localService)-Number(a.localService))[0]||null;
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
