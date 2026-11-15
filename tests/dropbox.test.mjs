import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
let api;
if (existsSync('static/saymore/shared/dropbox.mjs')) api = await import('../static/saymore/shared/dropbox.mjs');

test('OAuth callback rejects a different state and an expired request', () => {
  assert.ok(api, 'Dropbox connection is not implemented');
  const transaction = {nonce:'correct',startedAt:1000,verifier:'verifier',redirect:'https://example.com/'};
  assert.throws(()=>api.validateCallback(new URLSearchParams('state=wrong&code=code'),transaction,2000));
  assert.throws(()=>api.validateCallback(new URLSearchParams('state=correct&code=code'),transaction,1000000));
});

test('a Dropbox access error is not mistaken for an empty progress file', async () => {
  assert.ok(api);
  const client = new api.DropboxClient({appKey:'app',storage:memory(),fetchImpl:async()=>new Response(JSON.stringify({error_summary:'path/restricted_content',error:{path:{'.tag':'restricted_content'}}}),{status:409})});
  client.saveCredentials({appKey:'app',accountId:'account',accessToken:'test-token',refreshToken:'test-refresh',expiresAt:Date.now()+3600000});
  await assert.rejects(client.download('/ipa-progress.json'));
});

test('Dropbox updates use the observed file revision and preserve conflicts', async () => {
  assert.ok(api);
  let args;
  const client = new api.DropboxClient({appKey:'app',storage:memory(),fetchImpl:async(url,options)=>{
    args=JSON.parse(options.headers['Dropbox-API-Arg']);
    return new Response(JSON.stringify({error_summary:'path/conflict/file'}),{status:409});
  }});
  client.saveCredentials({appKey:'app',accountId:'account',accessToken:'test-token',refreshToken:'test-refresh',expiresAt:Date.now()+3600000});
  await assert.rejects(client.upload('/cards/library.json','new',{rev:'observed-revision'}),e=>e.conflict===true);
  assert.deepEqual(args.mode,{'.tag':'update',update:'observed-revision'});
  assert.equal(args.autorename,false);
});

test('new files are never silently renamed or overwritten', async () => {
  assert.ok(api);
  let args;
  const client = new api.DropboxClient({appKey:'app',storage:memory(),fetchImpl:async(url,options)=>{
    args=JSON.parse(options.headers['Dropbox-API-Arg']);
    return new Response('{"rev":"r1"}',{status:200});
  }});
  client.saveCredentials({appKey:'app',accountId:'account',accessToken:'test-token',refreshToken:'test-refresh',expiresAt:Date.now()+3600000});
  await client.upload('/cards/library.json','new');
  assert.deepEqual(args.mode,{'.tag':'add'});
  assert.equal(args.strict_conflict,true);
  await assert.rejects(client.download('/cards/../elsewhere'));
});

function memory(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}

test('native browser fetch keeps its Window receiver through the client',async()=>{
  const client=new api.DropboxClient({appKey:'app',storage:memory(),fetchImpl:function(){
    if(this!==globalThis)throw new TypeError('Illegal invocation');
    return Promise.resolve(new Response('{"ok":true}',{status:200}));
  }});
  const result=await client.request('https://example.com/',{method:'GET'});
  assert.equal(result.status,200);
});

const signIn=expiresAt=>({appKey:'app',accountId:'account',accessToken:'test-token',refreshToken:'test-refresh',expiresAt});
function recordingClient(respond){
  const calls=[],writes=[],storage=memory(),setItem=storage.setItem;
  storage.setItem=(k,v)=>{writes.push(k);return setItem(k,v);};
  const client=new api.DropboxClient({appKey:'app',storage,fetchImpl:async(url,options)=>{calls.push({url,options});return respond(url,options);}});
  return {client,calls,writes};
}
const tokenURL='https://api.dropboxapi.com/oauth2/token',revokeURL='https://api.dropboxapi.com/2/auth/token/revoke';

test('revoking with a still-valid access token calls only the revoke endpoint',async()=>{
  const {client,calls,writes}=recordingClient(()=>new Response('null',{status:200}));
  await client.revoke(signIn(Date.now()+3600000));
  assert.deepEqual(calls.map(c=>c.url),[revokeURL]);
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
  assert.deepEqual(writes,[]);
});

test('revoking with an expired access token fetches a fresh one first and never stores it',async()=>{
  const {client,calls,writes}=recordingClient(url=>new Response(url===tokenURL?'{"access_token":"fresh-token","expires_in":14400}':'null',{status:200}));
  await client.revoke(signIn(Date.now()-1000));
  assert.deepEqual(calls.map(c=>c.url),[tokenURL,revokeURL]);
  assert.equal(calls[1].options.headers.Authorization,'Bearer fresh-token');
  assert.deepEqual(writes,[]);
});

test('revoking offline finishes quietly',async()=>{
  const {client,calls}=recordingClient(()=>{throw new TypeError('Load failed');});
  await assert.doesNotReject(client.revoke(signIn(Date.now()-1000)));
  assert.equal(calls.length,1);
});

test('a request with a larger body is allowed more time',async()=>{
  const timeout=AbortSignal.timeout,limits=[];
  AbortSignal.timeout=ms=>{limits.push(ms);return timeout.call(AbortSignal,ms);};
  try{
    const client=new api.DropboxClient({appKey:'app',storage:memory(),fetchImpl:async()=>new Response('{}',{status:200})});
    await client.request('https://example.com/',{method:'POST'});
    await client.request('https://example.com/',{method:'POST',body:new Blob([new Uint8Array(1e6)])});
    await client.request('https://example.com/',{method:'POST',body:new Blob([new Uint8Array(5e6)])});
    assert.equal(limits.length,3);
    assert.ok(limits[0]<limits[1]&&limits[1]<limits[2],`timeouts ${limits}`);
  }finally{AbortSignal.timeout=timeout;}
});
