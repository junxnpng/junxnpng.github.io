import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
let parseBundle;
if(existsSync('static/saymore/cards/bundle.mjs'))({parseBundle}=await import('../static/saymore/cards/bundle.mjs'));
const entry=(path,text)=>({path,mime:'text/plain',base64:Buffer.from(text).toString('base64'),sha256:createHash('sha256').update(text).digest('hex')});

test('backup import reconstructs exact file bytes and relative paths',async()=>{
  assert.ok(parseBundle,'backup paste import is not implemented');
  const input={format:'saymore-card-bundle',version:1,files:[entry('library.json','한글\n'),entry('notes/a.md','my memo')]};
  const files=await parseBundle(JSON.stringify(input));
  assert.equal(files[0].path,'library.json');
  assert.equal(await files[0].blob.text(),'한글\n');
  assert.equal(await files[1].blob.text(),'my memo');
});

test('a modified backup is rejected before any file can be uploaded',async()=>{
  assert.ok(parseBundle);
  const input={format:'saymore-card-bundle',version:1,files:[entry('library.json','original')]};
  input.files[0].base64=Buffer.from('modified').toString('base64');
  await assert.rejects(parseBundle(JSON.stringify(input)),/내용/);
});

test('backup import rejects duplicate and unsafe file paths',async()=>{
  assert.ok(parseBundle);
  const input={format:'saymore-card-bundle',version:1,files:[entry('../secret','test')]};
  await assert.rejects(parseBundle(JSON.stringify(input)));
  input.files=[entry('library.json','one'),entry('library.json','two')];
  await assert.rejects(parseBundle(JSON.stringify(input)));
});
