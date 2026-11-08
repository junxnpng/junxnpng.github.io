const authKey = 'saymore.dropbox.auth.v1';
const transactionKey = 'saymore.dropbox.transaction.v1';
const scopes = 'files.metadata.read files.content.read files.content.write';
const base64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random = () => base64(crypto.getRandomValues(new Uint8Array(32)));
const headerJSON = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));

export function validateCallback(params, transaction, now = Date.now()) {
  if (!transaction || params.get('state') !== transaction.nonce || !transaction.verifier || !transaction.redirect || now-transaction.startedAt > 15*60000 || now < transaction.startedAt) throw Error('Dropbox 연결 요청이 만료되었거나 맞지 않습니다. 연결 버튼으로 다시 시작해 주세요.');
  if (params.has('error')) throw Error('Dropbox 연결을 취소했습니다. 기존 기록은 유지합니다.');
  if (!params.get('code')) throw Error('Dropbox 연결 코드를 확인하지 못했습니다.');
  return transaction;
}

export class DropboxClient {
  constructor({appKey, storage=globalThis.localStorage, fetchImpl=globalThis.fetch}) {
    this.appKey=appKey; this.storage=storage; this.fetch=fetchImpl.bind(globalThis); this.tokenTask=null;
  }
  get credentials() {
    try {
      const value=JSON.parse(this.storage.getItem(authKey)||'null');
      return value?.appKey===this.appKey && typeof value.refreshToken==='string' && typeof value.accountId==='string' ? value : null;
    } catch { return null; }
  }
  get connected() {return !!this.credentials;}
  get accountId() {return this.credentials?.accountId || null;}
  saveCredentials(value) {this.storage.setItem(authKey,JSON.stringify(value));}
  disconnect() {this.storage.removeItem(authKey);}
  async request(url, options) {
    for(let attempt=0;attempt<3;attempt++){
      const response=await this.fetch(url,{...options,credentials:'omit',signal:AbortSignal.timeout(25000)});
      if(response.status!==429||attempt===2)return response;
      const delay=Math.min(4000,Math.max(1000,(Number(response.headers.get('Retry-After'))||1)*1000));
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  }
  async token(params) {
    const response=await this.request('https://api.dropboxapi.com/oauth2/token',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.appKey,...params})
    });
    if(!response.ok)throw Error('Dropbox 연결을 갱신하지 못했습니다. 다시 연결해 주세요.');
    return response.json();
  }
  async accessToken() {
    const current=this.credentials;
    if(!current)throw Error('Dropbox를 먼저 연결해 주세요.');
    if(current.accessToken && current.expiresAt>Date.now()+60000)return current.accessToken;
    if(!this.tokenTask)this.tokenTask=(async()=>{
      const value=await this.token({grant_type:'refresh_token',refresh_token:current.refreshToken});
      if(this.credentials?.accountId!==current.accountId)throw Error('Dropbox 연결이 변경되었습니다.');
      this.saveCredentials({...current,accessToken:value.access_token,expiresAt:Date.now()+value.expires_in*1000});
      return value.access_token;
    })().finally(()=>{this.tokenTask=null;});
    return this.tokenTask;
  }
  async authorize() {
    if(!this.appKey)throw Error('Dropbox 앱 연결 설정이 필요합니다.');
    const verifier=random(),nonce=random(),redirect=location.origin+location.pathname;
    const challenge=base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    sessionStorage.setItem(transactionKey,JSON.stringify({verifier,nonce,redirect,startedAt:Date.now()}));
    const params=new URLSearchParams({client_id:this.appKey,response_type:'code',redirect_uri:redirect,token_access_type:'offline',code_challenge_method:'S256',code_challenge:challenge,state:nonce,scope:scopes});
    location.assign(`https://www.dropbox.com/oauth2/authorize?${params}`);
  }
  async finishAuthorization(search=location.search) {
    const params=new URLSearchParams(search);
    if(!params.has('code')&&!params.has('error'))return false;
    const raw=sessionStorage.getItem(transactionKey);
    sessionStorage.removeItem(transactionKey);
    history.replaceState(null,'',location.pathname+location.hash);
    const transaction=validateCallback(params,JSON.parse(raw||'null'));
    const value=await this.token({grant_type:'authorization_code',code:params.get('code'),code_verifier:transaction.verifier,redirect_uri:transaction.redirect});
    if(!value.refresh_token||!value.account_id)throw Error('Dropbox의 지속 연결 권한을 받지 못했습니다. 다시 연결해 주세요.');
    // Keep local progress from being silently uploaded to a different account.
    const bound=this.storage.getItem('saymore.dropbox.bound-account');
    if(bound&&bound!==value.account_id)throw Error('이 브라우저는 다른 Dropbox 계정에 연결된 적이 있습니다. 기존 계정으로 연결해 주세요.');
    this.saveCredentials({appKey:this.appKey,accountId:value.account_id,refreshToken:value.refresh_token,accessToken:value.access_token,expiresAt:Date.now()+value.expires_in*1000});
    this.storage.setItem('saymore.dropbox.bound-account',value.account_id);
    return true;
  }
  path(path) {
    if(typeof path!=='string'||!path.startsWith('/')||path.length>2000||path.split('/').some(p=>p==='..'||p==='.')||/[\x00-\x1f\\]/.test(path))throw Error('Dropbox 파일 경로를 확인해 주세요.');
    return path;
  }
  async error(response) {
    const value=await response.json().catch(()=>({}));
    const summary=value.error_summary||'';
    const message=response.status===401?'Dropbox 연결이 만료되었습니다. 다시 연결해 주세요.':response.status===429?'Dropbox 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.':response.status===507?'Dropbox 저장 공간이 부족합니다.':response.status===409&&/conflict/.test(summary)?'다른 기기에서 기록이 바뀌었습니다. 저장된 내용 다시 읽기를 눌러 주세요.':'Dropbox에서 파일을 읽거나 저장하지 못했습니다. 연결 상태와 앱 권한을 확인해 주세요.';
    return Object.assign(Error(message),{status:response.status,conflict:response.status===409&&/conflict/.test(summary),missing:response.status===409&&value.error?.path?.['.tag']==='not_found'});
  }
  async download(path) {
    this.path(path);
    const response=await this.request('https://content.dropboxapi.com/2/files/download',{method:'POST',headers:{Authorization:`Bearer ${await this.accessToken()}`,'Dropbox-API-Arg':headerJSON({path})}});
    if(!response.ok){const error=await this.error(response);if(error.missing)return null;throw error;}
    const metadata=JSON.parse(response.headers.get('Dropbox-API-Result')||'null');
    if(!metadata?.rev)throw Error('Dropbox 파일 버전을 확인하지 못했습니다. 기존 파일을 변경하지 않았습니다.');
    const blob=await response.blob();
    return {blob,metadata,text:()=>blob.text()};
  }
  async upload(path, data, {rev=null}={}) {
    this.path(path);
    const response=await this.request('https://content.dropboxapi.com/2/files/upload',{method:'POST',headers:{Authorization:`Bearer ${await this.accessToken()}`,'Content-Type':'application/octet-stream','Dropbox-API-Arg':headerJSON({path,mode:rev?{'.tag':'update',update:rev}:{'.tag':'add'},autorename:false,strict_conflict:true,mute:true})},body:data});
    if(!response.ok)throw await this.error(response);
    return response.json();
  }
  async mkdir(path) {
    this.path(path);
    const response=await this.request('https://api.dropboxapi.com/2/files/create_folder_v2',{method:'POST',headers:{Authorization:`Bearer ${await this.accessToken()}`,'Content-Type':'application/json'},body:JSON.stringify({path,autorename:false})});
    if(!response.ok){const error=await this.error(response);if(!error.conflict)throw error;}
  }
}

export async function openDropbox() {
  const search=location.search;
  const response=await fetch('/saymore/sync-config.json');
  if(!response.ok)throw Error('Dropbox 연결 설정을 불러오지 못했습니다.');
  const config=await response.json();
  const client=new DropboxClient({appKey:config.dropbox_app_key});
  await client.finishAuthorization(search);
  return client;
}
