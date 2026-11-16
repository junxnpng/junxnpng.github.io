import {test} from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for the page: just enough of an element to see what showCard builds.
function node(tag){
  const self={tag,children:[],attributes:{},className:'',textContent:'',hidden:false,
    append(...items){for(const item of items)self.children.push(typeof item==='string'?{tag:'#text',textContent:item,children:[]}:item);},
    replaceChildren(...items){self.children=[];self.append(...items);},
    setAttribute(name,value){self.attributes[name]=String(value);},
    addEventListener(){},
    get childElementCount(){return self.children.filter(child=>child.tag!=='#text').length;}};
  return self;
}
globalThis.document={createElement:node};
const {showCard}=await import('../static/saymore/cards/view.mjs');
const all=(root,match,found=[])=>{if(match(root))found.push(root);for(const child of root.children||[])all(child,match,found);return found;};
const card={type:'picture',front:'The ___ barks.',answer:'dog',ipa:'/dɑːɡ/',sentence:'The dog barks.',memory:'',speech:'dog',tags:['FF625'],image:{path:'media/x.png',credit:'Someone · CC0'}};

test('a card with a picture shows it on both sides, and the front does not name the answer',()=>{
  for(const answer of [false,true]){
    const box=node('div');
    showCard(box,card,{image:'blob:picture'},answer);
    const pictures=all(box,item=>item.tag==='img');
    assert.equal(pictures.length,1,answer?'back':'front');
    assert.equal(pictures[0].src,'blob:picture');
    if(!answer)assert.ok(!JSON.stringify(all(box,item=>item.tag!=='#text').map(item=>[item.alt,item.attributes])).includes('dog'));
  }
});

test('the preview draws while tags are still being typed as text',()=>{
  const box=node('div');
  assert.doesNotThrow(()=>showCard(box,{...card,tags:'food morning'},{},false));
  assert.doesNotThrow(()=>showCard(box,{...card,tags:''},{},true));
  // A word-form card typed into the editor still gets its hint line.
  showCard(box,{...card,type:'basic',front:'She ___ home.\nto go',tags:'FORM'},{},false);
  assert.equal(all(box,item=>item.className==='study-hint').length,1);
});

test('English text is marked as English and Korean explanations are not',()=>{
  const box=node('div');
  showCard(box,card,{},true);
  assert.equal(all(box,item=>item.className==='study-answer')[0].lang,'en');
  showCard(box,{...card,sentence:'앞쪽 높은 모음입니다.'},{},true);
  assert.equal(all(box,item=>item.className==='study-sentence')[0].lang,undefined);
});

test('a card with two recordings offers the sound and the word as separate buttons',()=>{
  const box=node('div');
  const two={...card,audio:{path:'media/a.mp3',credit:'symbol demo'},wordAudio:{path:'media/b.mp3',credit:'word · CC BY-SA'}};
  showCard(box,two,{audio:'blob:sound',wordAudio:'blob:word'},true);
  const buttons=all(box,item=>item.tag==='button').map(item=>item.textContent);
  assert.deepEqual(buttons.filter(text=>text.startsWith('▶')),['▶ 기호 소리','▶ 단어 소리','▶ 미국식 기기 합성 음성']);
  assert.deepEqual(all(box,item=>item.tag==='audio').map(item=>item.src),['blob:sound','blob:word']);
  // With one recording the labels stay as before, and nothing is offered on the front.
  showCard(box,{...card,audio:two.audio},{audio:'blob:sound'},true);
  assert.ok(all(box,item=>item.tag==='button').some(item=>item.textContent==='▶ 사람 녹음'));
  showCard(box,two,{audio:'blob:sound',wordAudio:'blob:word'},false);
  assert.equal(all(box,item=>item.tag==='audio').length,0);
});
