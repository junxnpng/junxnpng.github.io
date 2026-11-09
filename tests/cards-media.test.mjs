import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MediaCache} from '../static/saymore/cards/media-cache.mjs';

test('prefetch and display share one in-flight media download',async()=>{
  let finish,reads=0;
  const cache=new MediaCache(()=>{reads++;return new Promise(resolve=>{finish=resolve;});});
  const ahead=cache.source('audio.mp3'),visible=cache.source('audio.mp3');
  finish(new Blob(['audio']));
  const [one,two]=await Promise.all([ahead,visible]);
  assert.equal(one,two);assert.equal(await cache.source('audio.mp3'),one);assert.equal(reads,1);
  cache.clear();
  await assert.rejects(fetch(one));
});

test('changing storage while a download is pending cannot expose the old attachment',async()=>{
  let finish;
  const cache=new MediaCache(()=>new Promise(resolve=>{finish=resolve;}));
  const previous=cache.source('image.png');cache.clear();
  finish(new Blob(['old image']));
  await assert.rejects(previous,{name:'AbortError'});
  const current=cache.source('image.png');finish(new Blob(['new image']));
  assert.equal(await (await fetch(await current)).text(),'new image');
  cache.clear();
});

test('failed prefetches are retried when the card is opened',async()=>{
  let reads=0;
  const cache=new MediaCache(async()=>{if(++reads===1)throw Error('offline');return new Blob(['recovered']);});
  await assert.rejects(cache.source('audio.mp3'),/offline/);
  assert.equal(await (await fetch(await cache.source('audio.mp3'))).text(),'recovered');
  assert.equal(reads,2);cache.clear();
});
