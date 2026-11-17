import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackup,readBackup} from './backup.js';

test('对话备份往返保留图片、标题和置顶，不包含密钥',async()=>{
  const bytes=Uint8Array.from({length:70001},(_,i)=>i%251);
  const blob=new Blob([bytes],{type:'image/png'});
  const chats=[{id:'one',title:'示例',pinned:true,updatedAt:3,turns:[{prompt:'你好',references:[{name:'参考.png',blob}],images:[blob],status:'done'}]}];
  const backup=await createBackup(chats,{profiles:[{id:'custom',model:'test'}]},async()=>blob);
  const serialized=JSON.stringify(backup);
  assert.equal(serialized.includes('api-secret'),false);
  const restored=readBackup(serialized);
  assert.equal(restored.chats[0].title,'示例');
  assert.equal(restored.chats[0].pinned,true);
  assert.deepEqual(new Uint8Array(await restored.chats[0].turns[0].images[0].arrayBuffer()),bytes);
  assert.deepEqual(new Uint8Array(await restored.chats[0].turns[0].references[0].blob.arrayBuffer()),bytes);
});
