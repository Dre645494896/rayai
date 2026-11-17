import {copyFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const output=resolve(root,'dist/pages');
const files=['index.html','style.css','simple.css','chat.css','chat-v2.css','chat-v3.css','chat-app.js','chat-store.js','image-settings.js','api-client.js','backup.js','rayai-icon.png'];
const base=process.env.RAYAI_API_BASE_URL||'';
if(base&&(!/^https:\/\/[^/]+$/.test(base)||new URL(base).username||new URL(base).password))throw Error('RAYAI_API_BASE_URL 须为 HTTPS 服务源地址');
await mkdir(output,{recursive:true});
for(const file of files)await copyFile(resolve(root,file),resolve(output,file));
await writeFile(resolve(output,'rayai-config.js'),`globalThis.RAYAI_API_BASE=${JSON.stringify(base)};\n`);
await writeFile(resolve(output,'.nojekyll'),'');
console.log(`GitHub Pages 文件已生成：${output}`);
