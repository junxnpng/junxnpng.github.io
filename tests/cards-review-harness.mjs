// Manual browser regression fixture. Copy beside a built cards/index.html and replace
// that HTML's app.mjs script with this module. Serve only on loopback; no real Dropbox calls.
import {newLibrary,newCard} from './model.mjs?v=2';
if(!['localhost','127.0.0.1'].includes(location.hostname))throw Error('Local test fixture only');
const nativeFetch=globalThis.fetch.bind(globalThis),key='saymore.review-speed-test.library';
const panel=document.createElement('aside');
panel.style.cssText='padding:16px;background:#fff6cd;color:#222;position:relative;z-index:2';
panel.innerHTML='<strong>LOCAL TEST · 500 synthetic cards · 80ms/request</strong><p><label><input id="qa-audio" type="checkbox" checked> Hold audio</label> <label><input id="qa-notes" type="checkbox" checked> Hold reading notes</label> <label><input id="qa-fail-save" type="checkbox"> Fail next record save</label> <label><input id="qa-fail-note" type="checkbox"> Fail next note save</label></p><output id="qa-status"></output><pre id="qa-errors"></pre>';
document.body.prepend(panel);
const $=id=>document.getElementById(id),imagePath='media/00000000-0000-0000-0000-000000000001.jpg',audioPath='media/00000000-0000-0000-0000-000000000002.mp3';
const now=new Date(),seed=newLibrary(now);
seed.cards=Array.from({length:500},(_,i)=>newCard({type:'basic',deck:'속도 검증',front:`테스트 카드 ${i+1}`,answer:`answer ${i+1}`,image:i<3?{path:imagePath,credit:'fixture'}:null,audio:i<3?{path:audioPath,credit:'fixture'}:null},now));
const files=new Map([['/cards/library.json',{blob:new Blob([localStorage.getItem(key)||JSON.stringify(seed)]),rev:'1'}]]);
let revision=1,pendingNotes=0,pendingAudio=0,started=0,elapsed=null,listChanges=0,requests=0;
const errors=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const conflict=()=>json({error_summary:'path/conflict'},409);
async function status(){
  const library=JSON.parse(await files.get('/cards/library.json').blob.text());
  $('qa-status').textContent=`Transition: ${elapsed??'—'} ms | Saved reviews: ${library.cards.reduce((n,c)=>n+c.reviews.length,0)} | Pending notes: ${pendingNotes} | Pending audio: ${pendingAudio} | Library rebuilds: ${listChanges} | Requests: ${requests}`;
}
function failure(error){errors.push(String(error));$('qa-errors').textContent=errors.join('\n');}
window.addEventListener('error',e=>failure(e.message));
window.addEventListener('unhandledrejection',e=>failure(e.reason));
function held(id){
  if(!$(id).checked)return Promise.resolve();
  return new Promise(resolve=>{
    const change=()=>{if(!$(id).checked){$(id).removeEventListener('change',change);resolve();}};
    $(id).addEventListener('change',change);
  });
}
const appKey='local-review-test';
localStorage.setItem('saymore.dropbox.auth.v1',JSON.stringify({appKey,accountId:'synthetic',refreshToken:'fixture',accessToken:'fixture',expiresAt:Date.now()+3600000}));
globalThis.fetch=async(url,options={})=>{
  if(String(url)==='/saymore/sync-config.json')return json({dropbox_app_key:appKey});
  if(!String(url).includes('dropboxapi.com'))return nativeFetch(url,options);
  const action=String(url).split('/').at(-1);
  if(!['download','upload','create_folder_v2'].includes(action))throw Error('Unexpected test API');
  const args=JSON.parse(options.headers['Dropbox-API-Arg']||options.body),path=args.path;
  requests++;void status();await delay(80);
  if(action==='create_folder_v2')return json({});
  if(action==='download'){
    if(path.includes('/notes/')){pendingNotes++;void status();await held('qa-notes');pendingNotes--;}
    if(path==='/cards/'+audioPath){pendingAudio++;void status();await held('qa-audio');pendingAudio--;}
    if(path==='/cards/'+imagePath||path==='/cards/'+audioPath){
      if(!files.has(path)){const response=await nativeFetch(path.endsWith('.mp3')?'./sample/coffee.mp3':'./sample/coffee.jpg');files.set(path,{blob:await response.blob(),rev:'fixture'});}
    }
    const file=files.get(path);void status();
    return file?new Response(file.blob,{headers:{'Dropbox-API-Result':JSON.stringify({rev:file.rev})}}):json({error_summary:'path/not_found',error:{path:{'.tag':'not_found'}}},409);
  }
  for(const [id,match]of [['qa-fail-save',path==='/cards/library.json'],['qa-fail-note',path.includes('/notes/')]]){
    if(match&&$(id).checked){$(id).checked=false;void status();return json({error_summary:'test/offline'},503);}
  }
  const previous=files.get(path),expected=args.mode['.tag']==='update'?args.mode.update:null;
  if((previous?.rev||null)!==expected)return conflict();
  const blob=options.body instanceof Blob?options.body:new Blob([options.body]),rev=String(++revision);
  files.set(path,{blob,rev});
  if(path==='/cards/library.json')localStorage.setItem(key,await blob.text());
  void status();return json({rev});
};
document.addEventListener('click',event=>{if(event.target.closest('[data-rating]')&&!event.target.closest('button').disabled)started=performance.now();},true);
new MutationObserver(()=>{if(started&&$('review-card').querySelector('.study-prompt')){elapsed=Math.round(performance.now()-started);started=0;}void status();}).observe($('review-card'),{childList:true,subtree:true});
new MutationObserver(()=>{listChanges++;void status();}).observe($('card-list'),{childList:true});
await import('./app.mjs?v=review-speed-1');
