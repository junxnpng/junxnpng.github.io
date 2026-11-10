import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {newCard,parseLibrary,newLibrary,editCard} from '../static/saymore/cards/model.mjs';
let speech;if(existsSync('static/saymore/cards/speech.mjs'))speech=await import('../static/saymore/cards/speech.mjs');
test('only an available US voice is selected, with local voices preferred',()=>{
  assert.ok(speech,'US speech is not implemented');
  const british={lang:'en-GB',localService:true},us={lang:'en-US',localService:false},local={lang:'en_US',localService:true};
  assert.equal(speech.usVoice([british,us,local]),local);
  assert.equal(speech.usVoice([british]),null);
});
test('natural US voices are chosen over novelty and legacy voices listed first',()=>{
  const v=(name,localService=true,lang='en-US')=>({name,lang,localService});
  const mac=[v('Albert'),v('Bad News'),v('Eddy (영어(미국))'),v('Fred'),v('Samantha'),v('Zarvox'),v('Daniel',true,'en-GB')];
  assert.equal(speech.usVoice(mac).name,'Samantha');
  assert.equal(speech.usVoice([v('Samantha'),v('Ava (Premium)')]).name,'Ava (Premium)');
  assert.equal(speech.usVoice([v('Albert'),v('Some New Voice')]).name,'Some New Voice');
  assert.equal(speech.usVoice([v('Albert'),v('Fred')]).name,'Albert');
  assert.equal(speech.usVoice([v('Google US English',false),v('Bahh')]).name,'Google US English');
});
test('optional speech text is validated and preserved when editing without the speech field',()=>{
  const card=newCard({type:'basic',front:'moving air',answer:'wind',speech:'the wind'});
  assert.equal(card.speech,'the wind');
  const edited=editCard(card,{type:'basic',front:'moving air outside',answer:'wind'});
  assert.equal(edited.speech,'the wind');
  assert.equal(parseLibrary(JSON.stringify({...newLibrary(),cards:[card]})).cards[0].speech,'the wind');
  assert.throws(()=>newCard({...card,speech:42}));
  assert.throws(()=>newCard({...card,speech:'x'.repeat(301)}));
  const old=newCard({type:'basic',front:'old',answer:'old'});
  assert.equal(Object.hasOwn(old,'speech'),false);
});
