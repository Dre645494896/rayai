const imageType=/^image\/(png|jpeg|webp|gif)$/;

async function encodeImage(source,resolveImage){
  const blob=source instanceof Blob?source:await resolveImage(source);
  if(!(blob instanceof Blob)||!imageType.test(blob.type))throw Error('备份中有无法读取的图片');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  let base64='';
  for(let offset=0;offset<bytes.length;offset+=32766)base64+=btoa(String.fromCharCode(...bytes.subarray(offset,offset+32766)));
  return {type:blob.type,data:base64};
}

function decodeImage(value){
  if(!value||!imageType.test(value.type)||typeof value.data!=='string'||!/^[A-Za-z0-9+/=]*$/.test(value.data))throw Error('备份中的图片格式无效');
  const parts=value.data.match(/.{1,32768}/g)||[];
  const chunks=parts.map(part=>Uint8Array.from(atob(part),char=>char.charCodeAt(0)));
  return new Blob(chunks,{type:value.type});
}

export async function createBackup(chats,settings,resolveImage){
  const records=[];
  for(const chat of chats){
    const turns=[];
    for(const turn of chat.turns||[]){
      const references=[];
      for(const ref of turn.references||[])references.push({name:ref.name||'参考图',blob:await encodeImage(ref.blob,resolveImage)});
      const images=[];
      for(const image of turn.images||[])images.push(await encodeImage(image,resolveImage));
      turns.push({...turn,references,images});
    }
    records.push({...chat,turns});
  }
  return {kind:'rayai-backup',version:1,exportedAt:new Date().toISOString(),chats:records,settings};
}

export function readBackup(data){
  const value=typeof data==='string'?JSON.parse(data):data;
  if(value?.kind!=='rayai-backup'||value.version!==1||!Array.isArray(value.chats))throw Error('这不是受支持的 RayAI 备份文件');
  const chats=value.chats.map(chat=>{
    if(typeof chat?.id!=='string'||typeof chat.title!=='string'||!Array.isArray(chat.turns))throw Error('备份中的对话数据无效');
    const turns=chat.turns.map(turn=>{
      if(typeof turn?.prompt!=='string'||!Array.isArray(turn.references)||!Array.isArray(turn.images))throw Error('备份中的消息数据无效');
      return {...turn,references:turn.references.map(ref=>({name:String(ref.name||'参考图'),blob:decodeImage(ref.blob)})),images:turn.images.map(decodeImage)};
    });
    return {...chat,turns};
  });
  return {chats,settings:value.settings&&typeof value.settings==='object'?value.settings:{}};
}
