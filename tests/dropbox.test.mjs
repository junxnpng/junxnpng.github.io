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
