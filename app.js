const STORAGE = 'huashi-profiles-v1';
const $ = id => document.getElementById(id);
const defaultFields = [
  { name: 'size', type: 'select', options: 'auto,1024x1024,1536x1024,1024x1536', value: 'auto', modes: 'both' },
  { name: 'quality', type: 'select', options: 'auto,low,medium,high,xhigh,max', value: 'auto', modes: 'both' },
  { name: 'complexity', type: 'select', options: 'low,medium,high', value: 'high', modes: 'both' },
  { name: 'output_format', type: 'select', options: 'png,jpeg,webp', value: 'png', modes: 'both' }
];
const starter = () => ({ id: crypto.randomUUID(), name: 'Muze AI · Sunburst', baseUrl: 'https://api.muzeai.top/v1', model: 'gpt-image-2.6-sunburst', fields: structuredClone(defaultFields) });
function readProfiles() { try { const value = JSON.parse(localStorage.getItem(STORAGE)); if (Array.isArray(value) && value.length) return value; } catch {} return [starter()]; }
let profiles = readProfiles();
let current = profiles[0].id;
const sessionKeys = new Map();
let mode = 'generate';
let uploads = [];
let busy = false;
let pendingNew = false;
function active() { return profiles.find(p => p.id === current); }
function persist() { localStorage.setItem(STORAGE, JSON.stringify(profiles)); }
function showMessage(message, ok = false) { const el = $('message'); el.hidden = !message; el.textContent = message; el.classList.toggle('ok', ok); }
function renderSelector() { $('profile-select').replaceChildren(...profiles.map(p => { const option = document.createElement('option'); option.value = p.id; option.textContent = p.model || '新模型'; return option; })); $('profile-select').value = current; }
function renderProfile() { const p = active(); renderSelector(); $('base-url').value = p.baseUrl; $('model').value = p.model; $('api-key').value = sessionKeys.get(current) || ''; renderFields(); renderQuickParams(); updatePreview(); }
function renderQuickParams() {
  const container = $('quick-params'); container.replaceChildren();
  const fields = active().fields.filter(f => f.name && (f.modes === 'both' || f.modes === mode));
  if (!fields.length) return;
  const heading = document.createElement('h3'); heading.textContent = '画面设置'; container.append(heading);
  for (const field of fields) {
    const label = document.createElement('label'); label.textContent = ({size:'尺寸',quality:'画质',complexity:'细节程度',output_format:'文件格式'})[field.name] || field.name;
    let control;
    if (field.type === 'select') { control = document.createElement('select'); for (const value of field.options.split(',').map(s=>s.trim()).filter(Boolean)) { const option=document.createElement('option');option.value=value;option.textContent=value;control.append(option); } }
    else { control=document.createElement('input'); control.type='text'; control.placeholder='留空则不发送'; }
    control.value=field.value || '';
    control.oninput=()=>{ field.value=control.value; persist(); updatePreview(); };
    label.append(control); container.append(label);
  }
}
function fieldControl(field, index, key, label, kind = 'text') {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const input = kind === 'select' ? document.createElement('select') : document.createElement('input');
  if (kind === 'select') for (const value of key === 'type' ? ['text','number','boolean','select','json'] : ['both','generate','edit']) { const option = document.createElement('option'); option.value = value; option.textContent = value; input.append(option); }
  else input.type = 'text';
  input.value = field[key] || '';
  input.addEventListener('change', () => { active().fields[index][key] = input.value; renderFields(); renderQuickParams(); updatePreview(); });
  if (key === 'value') input.addEventListener('input', () => { active().fields[index][key] = input.value; renderQuickParams(); updatePreview(); });
  wrapper.append(input); return wrapper;
}
function renderFields() {
  const container = $('params'); container.replaceChildren();
  active().fields.forEach((field, index) => {
    const row = document.createElement('div'); row.className = 'param';
    row.append(fieldControl(field,index,'name','字段名'), fieldControl(field,index,'value','参数值'));
    const remove = document.createElement('button'); remove.className = 'remove'; remove.textContent = '×'; remove.title = '删除字段'; remove.addEventListener('click', () => { active().fields.splice(index,1); renderFields(); renderQuickParams(); updatePreview(); }); row.append(remove);
    const settings = document.createElement('div'); settings.className = 'param-settings';
    settings.append(fieldControl(field,index,'type','类型','select'), fieldControl(field,index,'modes','适用模式','select'));
    if (field.type === 'select') settings.append(fieldControl(field,index,'options','选项（逗号分隔）'));
    row.append(settings); container.append(row);
  });
}
function params() {
  const result = {};
  for (const field of active().fields) {
    if (field.modes !== 'both' && field.modes !== mode) continue;
    const name = field.name?.trim(); const raw = String(field.value ?? '').trim();
    if (!name || !raw) continue;
    if (['model','prompt','image','image[]'].includes(name)) throw new Error(`“${name}”是保留字段`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`字段名无效：${name}`);
    if (Object.hasOwn(result,name)) throw new Error(`参数重复：${name}`);
    if (field.type === 'select' && field.options && !field.options.split(',').map(s=>s.trim()).includes(raw)) throw new Error(`${name} 的值不在选项中`);
    if (field.type === 'number') { const value = Number(raw); if (!Number.isFinite(value)) throw new Error(`${name} 必须是数字`); result[name] = value; }
    else if (field.type === 'boolean') { if (!['true','false'].includes(raw)) throw new Error(`${name} 必须是 true 或 false`); result[name] = raw === 'true'; }
    else if (field.type === 'json') { try { result[name] = JSON.parse(raw); } catch { throw new Error(`${name} 的 JSON 格式无效`); } }
    else result[name] = raw;
  }
  return result;
}
function updatePreview() { try { $('preview').textContent = JSON.stringify({ model: $('model').value, prompt: $('prompt').value, ...(mode === 'edit' ? { image: `${uploads.length} 张参考图` } : {}), ...params() },null,2); } catch (error) { $('preview').textContent = error.message; } }
function fileData(file) { return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, data: reader.result }); reader.onerror = reject; reader.readAsDataURL(file); }); }
function renderFiles() { $('file-list').replaceChildren(...uploads.map((item,i) => { const el = document.createElement('div'); el.className='file-item'; el.append(document.createTextNode(item.name+' ')); const btn=document.createElement('button'); btn.textContent='×'; btn.onclick=()=>{uploads.splice(i,1);renderFiles();updatePreview();}; el.append(btn); return el; })); }
async function readParams() {
  const baseUrl=$('base-url').value.trim(), model=$('model').value.trim();
  if (!baseUrl || !model) { $('discover-status').textContent='请先填写 API 地址和模型 ID。'; return false; }
  $('discover-status').textContent='正在读取接口参数…'; $('read-params').disabled=true;
  try {
    const response=await fetch('/api/discover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl,model,apiKey:$('api-key').value.trim()})});
    const data=await response.json(); if(!response.ok) throw new Error(data.error);
    active().fields=data.fields; renderFields(); renderQuickParams(); updatePreview(); $('discover-status').textContent=data.source; return true;
  } catch(error) { $('discover-status').textContent=`读取失败：${error.message}`; return false; }
  finally { $('read-params').disabled=false; }
}
async function saveInputs() { const p = active(); if (!$('base-url').value.trim() || !$('model').value.trim()) { $('discover-status').textContent='请填写 API 地址和模型 ID。'; return; } const changed=p.baseUrl!==$('base-url').value.trim()||p.model!==$('model').value.trim(); if(pendingNew||changed) await readParams(); p.name = $('model').value.trim(); p.baseUrl = $('base-url').value.trim(); p.model = $('model').value.trim(); sessionKeys.set(current,$('api-key').value); persist(); pendingNew=false; renderSelector(); $('model-dialog').close(); showMessage('模型已保存。'+$('discover-status').textContent,true); }
let viewerScale = 1;
function setViewerScale(scale) { viewerScale = Math.min(5, Math.max(0.25, scale)); $('viewer-image').style.transform = `scale(${viewerScale})`; $('viewer-zoom').textContent = `${Math.round(viewerScale * 100)}%`; }
function openViewer(src, alt) { $('viewer-image').src = src; $('viewer-image').alt = alt; setViewerScale(1); $('image-viewer').showModal(); }
function addResult(src, index) { const card = document.createElement('div'); card.className = 'result-card'; const img = document.createElement('img'); img.src = src; img.alt = `生成图片 ${index}`; img.tabIndex=0; img.setAttribute('role','button'); img.setAttribute('aria-label',`放大查看生成图片 ${index}`); img.onclick=()=>openViewer(src,img.alt); img.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openViewer(src,img.alt);}}; const actions = document.createElement('div'); actions.className='result-actions'; const label=document.createElement('span'); label.textContent=`作品 ${index}`; const link=document.createElement('a'); link.href=src; link.download=`huashi-${Date.now()}-${index}.png`; link.textContent='下载 ↗'; if(src.startsWith('https://')) link.onclick=async e=>{e.preventDefault();try{const response=await fetch('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:src})});if(!response.ok){const err=await response.json();throw new Error(err.error);}const blob=await response.blob();const local=URL.createObjectURL(blob);const a=document.createElement('a');a.href=local;a.download=`huashi-${Date.now()}-${index}.${blob.type.split('/')[1]||'png'}`;a.click();setTimeout(()=>URL.revokeObjectURL(local),30000);}catch(error){showMessage(error.message);}}; actions.append(label,link); card.append(img,actions); $('gallery').prepend(card); }
async function generate() {
  if (busy) return;
  try {
    const body = { baseUrl: $('base-url').value.trim(), apiKey: $('api-key').value.trim(), model: $('model').value.trim(), prompt: $('prompt').value.trim(), mode, params: params(), images: mode === 'edit' ? uploads : [] };
    if (!body.baseUrl || !body.apiKey || !body.model || !body.prompt) throw new Error('请填写接口地址、API Key、模型和提示词');
    if (mode === 'edit' && !uploads.length) throw new Error('图生图请先上传参考图');
    busy=true; $('generate').disabled=true; $('generate').textContent='正在生成，请稍候…'; showMessage('正在等待接口返回图片。');
    const response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json(); if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);
    $('empty').hidden=true; data.images.forEach((src,i)=>addResult(src,i+1)); $('result-count').textContent=`${$('gallery').children.length} 张图片`; showMessage(`成功生成 ${data.images.length} 张图片。`,true);
  } catch (error) { showMessage(error.message); }
  finally { busy=false; $('generate').disabled=false; $('generate').innerHTML='✦ 生成图片 <span>→</span>'; }
}
$('profile-select').onchange=e=>{sessionKeys.set(current,$('api-key').value);current=e.target.value;renderProfile();showMessage('');};
$('new-profile').onclick=()=>{sessionKeys.set(current,$('api-key').value);const p={id:crypto.randomUUID(),name:'新模型',baseUrl:'',model:'',fields:[]};profiles.push(p);current=p.id;pendingNew=true;renderProfile();$('dialog-title').textContent='添加模型';$('model-dialog').showModal();};
$('edit-profile').onclick=()=>{$('dialog-title').textContent='管理模型';$('model-dialog').showModal();};
$('close-dialog').onclick=()=>{$('model-dialog').close();};
$('viewer-close').onclick=()=>{$('image-viewer').close();};
$('viewer-reset').onclick=()=>setViewerScale(1);
$('viewer-stage').addEventListener('wheel',e=>{e.preventDefault();setViewerScale(viewerScale*(e.deltaY<0?1.12:1/1.12));},{passive:false});
$('model-dialog').addEventListener('close',()=>{if(pendingNew){profiles=profiles.filter(p=>p.id!==current);current=profiles[0].id;pendingNew=false;renderProfile();}});
$('save-profile').onclick=saveInputs;
$('read-params').onclick=readParams;
$('delete-profile').onclick=()=>{if(profiles.length===1){showMessage('至少保留一个模型。');return;}sessionKeys.delete(current);profiles=profiles.filter(p=>p.id!==current);current=profiles[0].id;pendingNew=false;persist();renderProfile();$('model-dialog').close();showMessage('模型已删除。',true);};
$('toggle-key').onclick=()=>{const key=$('api-key');key.type=key.type==='password'?'text':'password';$('toggle-key').textContent=key.type==='password'?'显示':'隐藏';};
document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>{mode=tab.dataset.mode;document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===tab));$('upload-area').hidden=mode!=='edit';renderQuickParams();updatePreview();});
$('add-field').onclick=()=>{active().fields.push({name:'',type:'text',value:'',options:'',modes:'both'});renderFields();};
$('file-input').onchange=async e=>{for(const file of e.target.files){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024){showMessage(`${file.name} 格式不支持或超过 20 MB`);continue;}uploads.push(await fileData(file));}e.target.value='';renderFiles();updatePreview();};
$('prompt').oninput=updatePreview;$('model').oninput=updatePreview;$('generate').onclick=generate;
renderProfile();
if (!$('api-key').value) showMessage('首次使用请点击“管理模型”，填写 API Key。',true);
