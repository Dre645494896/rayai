import { chatStore } from './chat-store.js';
import { RATIOS, TIERS, family, officialFields, sanitizeOutput, resolveSize } from './image-settings.js';
import { isQualityField, qualityOptions, showWorkspaceField, workspaceBuiltinFields, workspaceFieldValue, workspaceParams, prepareGeneratedPngs } from './workspace-generation.js';
import { apiFetch, rememberInvite } from './api-client.js';
import { createBackup, readBackup } from './backup.js';
import { startAurora } from './aurora.js';
import { closeAccountMenu, closeSidebarPopovers } from './production-wallet.js';
import { selectionPill } from './workspace-selection.js';

document.documentElement.dataset.appReady='true';

const $ = id => document.getElementById(id);
// The glyphs are document-local symbols in index.html; names are fixed by the UI.
const iconMarkup = (name, sidebar=false) => `<svg class="workspace-icon${sidebar?' sidebar-icon':''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-${name}"/></svg>`;

const PROFILE_KEY = 'huashi-profiles-v1';
const KEY_STORE = 'huashi-api-keys-v1';
const PREF_KEY = 'huashi-image-preferences-v1';
const ACTIVE_CHAT_KEY = 'huashi-active-chat-v1';
const ACTIVE_PROFILE_KEY = 'huashi-active-model-v1';
const builtinModels=['gpt-image-2.6-sunburst','gpt-image-2.5-sunburst','gpt-image-2'];
const builtinProfiles=()=>builtinModels.map(model=>({id:`builtin:${model}`,model,builtIn:true,baseUrl:'',fields:workspaceBuiltinFields(),parameterSource:'official',layout:{ratio:'auto',tier:'standard'}}));
function loadProfiles(){let list=[];try{const saved=JSON.parse(localStorage.getItem(PROFILE_KEY));if(Array.isArray(saved))list=saved.filter(p=>p&&!p.builtIn&&!String(p.id).startsWith('builtin:'));}catch{}for(const p of list){p.fields=sanitizeOutput(p.fields||[]);if(family(p.model)&&p.parameterSource!=='api'){const previousSize=p.fields.find(x=>x.name==='size')?.value;const preset=officialFields(p.model).filter(f=>!isQualityField(f));p.fields=[...preset.map(f=>{const old=p.fields.find(x=>x.name===f.name);return {...f,value:old&&(!f.options||f.options.split(',').includes(old.value))?old.value:f.value};}),...p.fields.filter(f=>!preset.some(x=>x.name===f.name))];p.parameterSource='official';if(!p.layout&&/^\d+x\d+$/.test(previousSize||'')){const [width,height]=previousSize.split('x').map(Number);p.layout={ratio:'custom',tier:'standard',width,height};}}p.layout ||= {ratio:'auto',tier:'standard'};}return [...builtinProfiles(),...list];}
let profiles=loadProfiles(), profileId=profiles.find(p=>p.id===localStorage.getItem(ACTIVE_PROFILE_KEY))?.id||'builtin:gpt-image-2.6-sunburst', pendingProfile=false;
function loadPreferences(){try{const value=JSON.parse(localStorage.getItem(PREF_KEY));if(value&&typeof value==='object'&&value.layout&&value.fields)return value;}catch{}const active=profiles.find(p=>p.id===profileId);return {layout:{...active.layout},fields:Object.fromEntries(active.fields.filter(f=>f.name).map(f=>[f.name,{type:f.type,value:f.value}]))};}
const preferences=loadPreferences();
function savePreferences(){localStorage.setItem(PREF_KEY,JSON.stringify(preferences));}
function effectiveLayout(){const layout={...preferences.layout};if(!RATIOS.includes(layout.ratio))layout.ratio='auto';if(!TIERS.includes(layout.tier))layout.tier='standard';if(layout.ratio!=='custom'&&resolveSize(layout).error){layout.tier='standard';if(resolveSize(layout).error)layout.ratio='auto';}return layout;}
function preferenceKey(field){return isQualityField(field)?'quality':field.name;}
function effectiveFieldValue(field){return workspaceFieldValue(field,preferences.fields[preferenceKey(field)]);}
function rememberField(field){if(!field.name)return;preferences.fields[preferenceKey(field)]={type:field.type,value:field.value};savePreferences();}
function loadSavedKeys(){try{const data=JSON.parse(localStorage.getItem(KEY_STORE));if(data&&typeof data==='object'&&!Array.isArray(data))return new Map(Object.entries(data).filter(([id,key])=>profiles.some(p=>p.id===id&&!p.builtIn)&&typeof key==='string'&&key.length));}catch{}return new Map();}
const savedKeys=loadSavedKeys(), sessionKeys=new Map(savedKeys);
function saveKeys(){localStorage.setItem(KEY_STORE,JSON.stringify(Object.fromEntries(savedKeys)));}
let chats=[], chatId=null, uploads=[], busy=false, pendingDelete=null, viewerScale=1, viewerUrl=null, viewerSource=null, viewerOffsetX=0, viewerOffsetY=0, viewerPan=null, suppressViewerClick=false, suppressViewerContextMenu=false, contextImage=null;
let renderedUrls=[], saveQueue=Promise.resolve();
const profile=()=>profiles.find(p=>p.id===profileId);
const chat=()=>chats.find(c=>c.id===chatId);
const mode=()=>uploads.length?'edit':'generate';
function saveProfiles(){localStorage.setItem(PROFILE_KEY,JSON.stringify(profiles.filter(p=>!p.builtIn)));}
let noticeTimer;
function notice(message,good=false,brief=false){
  clearTimeout(noticeTimer);
  const status=$('message');
  status.hidden=!message;
  status.textContent=message;
  status.classList.toggle('ok',good);
  if(message&&good&&brief)noticeTimer=setTimeout(()=>notice(''),2500);
}
function persistChat(item){const snapshot=structuredClone(item);saveQueue=saveQueue.catch(()=>{}).then(()=>chatStore.save(snapshot));return saveQueue.catch(error=>{notice(`保存对话失败：${error.message}。刷新后这轮可能无法恢复。`);throw error;});}
function createChat(){const now=Date.now();const item={id:crypto.randomUUID(),title:'新聊天',manualTitle:false,pinned:false,createdAt:now,updatedAt:now,turns:[]};chats.unshift(item);chatId=item.id;localStorage.setItem(ACTIVE_CHAT_KEY,item.id);return item;}
function newChat(){chatId=null;localStorage.removeItem(ACTIVE_CHAT_KEY);$('prompt').value='';uploads=[];renderUploads();notice('');renderChatList();renderConversation();closeSidebar();}
function selectChat(id,refreshList=true){chatId=id;localStorage.setItem(ACTIVE_CHAT_KEY,id);if(refreshList)renderChatList();else updateChatSelection();renderConversation();closeSidebar();}
const mobileSidebar = matchMedia('(max-width: 760px)');
const railStorageKey = 'rayai-sidebar-collapsed-v1';
function setRailCollapsed(collapsed) {
  document.body.classList.toggle('rail-collapsed', collapsed);
  const button = $('desktop-sidebar-toggle');
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
  button.querySelector('use').setAttribute('href', collapsed ? '#icon-panel-left-open' : '#icon-panel-left-close');
  const hideList = !mobileSidebar.matches && collapsed;
  if (hideList) {
    if ($('chat-list').contains(document.activeElement)) button.focus({preventScroll:true});
    closeHistoryActions();
  }
  $('chat-list').inert = hideList;
}
function syncSidebarLayout() {
  if (!mobileSidebar.matches) closeSidebar();
  const area = document.querySelector('.account-area');
  const destination = $(mobileSidebar.matches ? 'mobile-account' : 'desktop-account');
  closeHistoryActions();
  if (area.parentElement !== destination) {
    const focused = area.contains(document.activeElement) ? document.activeElement : null;
    closeSidebarPopovers();
    destination.append(area);
    if (focused) $('wallet-popover').contains(focused) || focused === $('store-open')
      ? $('store-open').focus({preventScroll:true}) : $('account-toggle').focus({preventScroll:true});
  }
  const drawerClosed = mobileSidebar.matches && !document.body.classList.contains('sidebar-open');
  if (drawerClosed && $('sidebar').contains(document.activeElement)) $('sidebar-toggle').focus({preventScroll:true});
  $('sidebar').inert = drawerClosed;
  setRailCollapsed(localStorage.getItem(railStorageKey) === 'true');
}
function setSidebar(open){
  const toggle=$('sidebar-toggle');
  const sidebar=$('sidebar');
  const restoreFocus=!open && sidebar.contains(document.activeElement);
  if (open) closeSidebarPopovers();
  else closeHistoryActions();
  document.body.classList.toggle('sidebar-open',open);
  $('sidebar-shade').hidden=!open;
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open?'关闭对话列表':'打开对话列表');
  toggle.querySelector('use').setAttribute('href', open ? '#icon-x' : '#icon-menu');
  sidebar.inert = mobileSidebar.matches && !open;
  if(open)$('new-chat').focus({preventScroll:true});
  else if(restoreFocus)(mobileSidebar.matches ? toggle : $('desktop-sidebar-toggle')).focus({preventScroll:true});
}
function closeSidebar(){if(document.body.classList.contains('sidebar-open'))setSidebar(false);}
function updateChatSelection(){
  for(const row of $('chat-list').children){
    const current=row.dataset.id===chatId;
    row.classList.toggle('active',current);
    row.querySelector('.chat-select')?.setAttribute('aria-current',String(current));
  }
}
const rowIcons={pin:'pin',rename:'pencil',remove:'trash-2'};
let historyActions;
function closeHistoryActions(restoreFocus=false){
  if(!historyActions)return;
  const {trigger,panel}=historyActions;
  historyActions=null;
  panel.hidePopover?.();
  panel.hidden=true;
  trigger.setAttribute('aria-expanded','false');
  if(restoreFocus)trigger.focus({preventScroll:true});
}
function openHistoryActions(trigger,panel){
  const opening=historyActions?.trigger!==trigger;
  closeHistoryActions(!opening);
  if(!opening)return;
  if (!panel.showPopover) panel.removeAttribute('popover');
  panel.hidden=false;
  panel.showPopover?.();
  historyActions={trigger,panel};
  trigger.setAttribute('aria-expanded','true');
  const anchor=trigger.getBoundingClientRect(), box=panel.getBoundingClientRect();
  panel.style.left=`${Math.max(8,Math.min(anchor.right-box.width,innerWidth-box.width-8))}px`;
  panel.style.top=`${Math.max(8,Math.min(anchor.bottom+box.height+12<=innerHeight ? anchor.bottom+4 : anchor.top-box.height-4,innerHeight-box.height-8))}px`;
  panel.querySelector('button').focus({preventScroll:true});
}
function chatAction(icon,label,activate,glyph=rowIcons[icon]){
  const button=document.createElement('button');
  button.type='button';
  button.className=`chat-action ${icon}-chat`;
  button.innerHTML=iconMarkup(glyph,true);
  button.append(label);
  button.onclick=activate;
  return button;
}
const findChatRow=id=>[...$('chat-list').children].find(row=>row.dataset.id===id);
function restoreChatFocus(id, selector='.chat-more') {
  const list=$('chat-list');
  if(list.inert || $('sidebar').inert)return;
  (findChatRow(id)?.querySelector(selector) || list.querySelector('.chat-more') || $('new-chat')).focus({preventScroll:true});
}
function renderChatList(){
  const list=$('chat-list');
  const focused=document.activeElement;
  const focusedRow=focused.closest('.chat-row');
  const restoreId=historyActions?.panel.contains(focused) ? historyActions.trigger.closest('.chat-row').dataset.id : focusedRow?.dataset.id;
  const restoreTarget=focused.matches('.chat-select') ? '.chat-select' : '.chat-more';
  closeHistoryActions();
  list.replaceChildren();
  for(const item of [...chats].filter(c=>c.turns?.length).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.updatedAt-a.updatedAt)){
    const row=document.createElement('div');
    row.className='chat-row'+(item.pinned?' pinned':'');
    row.dataset.id=item.id;
    const select=document.createElement('button');
    select.type='button';
    select.className='chat-select';
    select.textContent=item.title;
    if(item.pinned)select.setAttribute('aria-label',`${item.title}，已置顶`);
    select.title=item.title;
    select.onclick=()=>selectChat(item.id,false);
    const more=document.createElement('button');
    more.type='button';
    more.className='chat-more';
    more.innerHTML=iconMarkup('ellipsis',true);
    more.title='对话操作';
    more.setAttribute('aria-label',`对话操作：${item.title}`);
    more.setAttribute('aria-expanded','false');
    const actions=document.createElement('div');
    actions.className='chat-actions';
    actions.id=`chat-actions-${item.id}`;
    actions.setAttribute('popover','manual');
    actions.hidden=true;
    more.setAttribute('aria-controls',actions.id);
    more.onclick=()=>openHistoryActions(more,actions);
    const pin=chatAction('pin',item.pinned?'取消置顶':'置顶',()=>{
      closeHistoryActions(true);
      item.pinned=!item.pinned;
      persistChat(item).catch(()=>{});
      renderChatList();
    },item.pinned?'pin-off':'pin');
    const rename=chatAction('rename','重命名',()=>{closeHistoryActions(true);renameChat(item);});
    const remove=chatAction('remove','删除',()=>{closeHistoryActions(true);pendingDelete=item.id;$('confirm-dialog').showModal();});
    actions.append(pin,rename,remove);
    row.append(select,more,actions);
    list.append(row);
  }
  if (!list.children.length) {
    const empty = document.createElement('p');
    empty.className = 'rail-empty';
    empty.textContent = '暂无对话';
    list.append(empty);
  }
  updateChatSelection();
  if(restoreId)restoreChatFocus(restoreId,restoreTarget);
}
function renameChat(item){
  const row=findChatRow(item.id), target=row?.querySelector('.chat-select');
  if(!target)return;
  const input=document.createElement('input');
  input.className='rename-input';
  input.value=item.title;
  input.setAttribute('aria-label','重命名对话');
  target.replaceWith(input);
  input.focus();
  input.select();
  let done=false;
  const finish=(save,restoreFocus=false)=>{
    if(done)return;
    done=true;
    const value=input.value.trim();
    if(save&&value&&value!==item.title){
      item.title=value;item.manualTitle=true;item.updatedAt=Date.now();persistChat(item).catch(()=>{});
      target.textContent=value;target.title=value;
      if(item.pinned)target.setAttribute('aria-label',`${value}，已置顶`);
      row.querySelector('.chat-more').setAttribute('aria-label',`对话操作：${value}`);
      renderConversation();
    }
    input.replaceWith(target);
    if(restoreFocus){row.querySelector('.chat-more').focus({preventScroll:true});renderChatList();}
  };
  input.onkeydown=e=>{
    if(e.isComposing||!['Enter','Escape'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();finish(e.key==='Enter',true);
  };
  input.onblur=()=>finish(true);
}
function assetUrl(blob){const url=URL.createObjectURL(blob);renderedUrls.push(url);return url;}
function imageElement(blobOrUrl,alt){const src=blobOrUrl instanceof Blob?assetUrl(blobOrUrl):blobOrUrl;const image=document.createElement('img');image.src=src;image.alt=alt;image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label',`放大查看${alt}`);const open=()=>openViewer(blobOrUrl,alt);image.onclick=open;image.oncontextmenu=e=>showImageMenu(e,blobOrUrl);image.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};return image;}
function renderConversation(){for(const url of renderedUrls)URL.revokeObjectURL(url);renderedUrls=[];const item=chat();$('chat-title').textContent=item?.title||'新聊天';const container=$('turns');container.replaceChildren();$('welcome').hidden=!!item?.turns.length;if(!item)return;for(const turn of item.turns){const group=document.createElement('article');group.className='turn';const user=document.createElement('div');user.className='user-bubble';const text=document.createElement('p');text.textContent=turn.prompt;user.append(text);if(turn.references?.length){const refs=document.createElement('div');refs.className='turn-images refs';for(const ref of turn.references)refs.append(imageElement(ref.blob,ref.name||'参考图'));user.append(refs);}group.append(user);const answer=document.createElement('div');answer.className='assistant-bubble';const meta=document.createElement('div');meta.className='answer-meta';meta.textContent=turn.model||'图片生成';answer.append(meta);if(turn.status==='pending'){const placeholder=document.createElement('div');placeholder.className='generation-placeholder';const aspect=turn.aspectRatio||1;placeholder.style.aspectRatio=String(aspect);placeholder.style.width=`min(${Math.min(360,Math.round(320*aspect))}px, 100%)`;const glow=document.createElement('div');glow.className='generation-glow';placeholder.append(glow);const label=document.createElement('span');label.textContent=turn.sizeLabel==='自动尺寸'?'自动尺寸 · 正在生成':'正在生成图片';placeholder.append(label);answer.append(placeholder);}if(turn.images?.length){const grid=document.createElement('div');grid.className='turn-images results-images';for(const blobOrUrl of turn.images){const frame=document.createElement('div');frame.className='image-frame';frame.append(imageElement(blobOrUrl,'生成图片'));const download=document.createElement('button');download.className='download-image';download.innerHTML=iconMarkup('download');download.append(' 下载图片');download.onclick=()=>downloadImage(blobOrUrl);frame.append(download);grid.append(frame);}answer.append(grid);}if(turn.error){const p=document.createElement('p');p.className='turn-error';p.textContent=turn.error;answer.append(p);}group.append(answer);container.append(group);}container.lastElementChild?.scrollIntoView({block:'end'});}
function renderTurnActions(){const item=chat();if(!item)return;[...$('turns').children].forEach((group,index)=>{const turn=item.turns[index],user=group.querySelector('.user-bubble');if(!turn||!user)return;const actions=document.createElement('div');actions.className='message-actions';const copy=document.createElement('button');copy.type='button';copy.title='复制提示词';copy.setAttribute('aria-label','复制提示词');copy.innerHTML=iconMarkup('copy');copy.onclick=async()=>{try{await navigator.clipboard.writeText(turn.prompt);notice('提示词已复制。',true,true);}catch(error){notice(`复制失败：${error.message}`);}};const edit=document.createElement('button');edit.type='button';edit.title='修改并重新生成';edit.setAttribute('aria-label','修改并重新生成');edit.innerHTML=iconMarkup('pencil');edit.onclick=()=>{const old=user.querySelector('.message-editor');if(old){old.remove();return;}const editor=document.createElement('div');editor.className='message-editor';const input=document.createElement('textarea');input.value=turn.prompt;input.setAttribute('aria-label','修改提示词');const row=document.createElement('div');const cancel=document.createElement('button');cancel.textContent='取消';cancel.onclick=()=>editor.remove();const confirm=document.createElement('button');confirm.textContent='确认并生成';confirm.className='confirm-edit';confirm.onclick=async()=>{if(busy){notice('请等待当前图片生成完成。');return;}const prompt=input.value.trim();if(!prompt){notice('请输入画面描述。');return;}await generate({prompt,references:turn.references||[],origin:item});};row.append(cancel,confirm);editor.append(input,row);user.append(editor);input.focus();input.select();};actions.append(copy,edit);user.append(actions);});}
const baseRenderConversation=renderConversation;
renderConversation=()=>{document.querySelector('.chat-workspace').classList.toggle('is-empty', !chat()?.turns.length);baseRenderConversation();renderTurnActions();};
function downloadImage(blobOrUrl){const src=blobOrUrl instanceof Blob?URL.createObjectURL(blobOrUrl):blobOrUrl;const link=document.createElement('a');link.href=src;link.download=`rayai-${Date.now()}.${blobOrUrl instanceof Blob?(blobOrUrl.type.split('/')[1]||'png'):'png'}`;link.click();if(blobOrUrl instanceof Blob)setTimeout(()=>URL.revokeObjectURL(src),30000);}
function closeImageMenu(){$('image-menu').hidden=true;contextImage=null;}
function showImageMenu(event,source){event.preventDefault();event.stopPropagation();contextImage=source;const menu=$('image-menu');( $('image-viewer').open ? $('image-viewer') : document.body ).append(menu);menu.hidden=false;const rect=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(event.clientX,innerWidth-rect.width-8))}px`;menu.style.top=`${Math.max(8,Math.min(event.clientY,innerHeight-rect.height-8))}px`;}
async function pngBlob(source){const blob=source instanceof Blob?source:await imageBlob(source);if(blob.type==='image/png')return blob;let bitmap,url;try{try{bitmap=await createImageBitmap(blob);}catch{url=URL.createObjectURL(blob);bitmap=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('无法解码图片'));image.src=url;});}const canvas=document.createElement('canvas');canvas.width=bitmap.width||bitmap.naturalWidth;canvas.height=bitmap.height||bitmap.naturalHeight;canvas.getContext('2d').drawImage(bitmap,0,0);return await new Promise((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(Error('图片转换失败')),'image/png'));}finally{bitmap?.close?.();if(url)URL.revokeObjectURL(url);}}
async function performImageMenu(action,source){if(action==='download'){downloadImage(source instanceof Blob?source:await imageBlob(source));return;}if(action==='copy'){await navigator.clipboard.write([new ClipboardItem({'image/png':await pngBlob(source)})]);notice('图片已复制。',true,true);return;}if(action==='attach'){let blob=source instanceof Blob?source:await imageBlob(source);if(!['image/png','image/jpeg','image/webp'].includes(blob.type))blob=await pngBlob(blob);const name=`参考图-${Date.now()}.${blob.type==='image/jpeg'?'jpg':blob.type==='image/webp'?'webp':'png'}`;const before=uploads.length;await addFiles([new File([blob],name,{type:blob.type})]);if(uploads.length===before)throw Error('图片未能作为附件添加');if($('image-viewer').open)$('image-viewer').close();$('prompt').focus();notice('图片已添加到输入框。',true,true);}}
function renderViewer(){const image=$('viewer-image'),stage=$('viewer-stage');const maxX=Math.max(0,(image.offsetWidth*viewerScale-stage.clientWidth)/2),maxY=Math.max(0,(image.offsetHeight*viewerScale-stage.clientHeight)/2);viewerOffsetX=Math.max(-maxX,Math.min(maxX,viewerOffsetX));viewerOffsetY=Math.max(-maxY,Math.min(maxY,viewerOffsetY));image.style.transform=`translate(${viewerOffsetX}px,${viewerOffsetY}px) scale(${viewerScale})`;stage.classList.toggle('can-pan',maxX>0||maxY>0);$('viewer-zoom').textContent=`${Math.round(viewerScale*100)}%`;}
function setViewerScale(value){viewerScale=Math.min(5,Math.max(.25,value));if(viewerScale===1){viewerOffsetX=0;viewerOffsetY=0;}renderViewer();}
function stopViewerPan(){if(!viewerPan)return;const pointerId=viewerPan.pointerId;viewerPan=null;$('viewer-stage').classList.remove('panning');if($('viewer-stage').hasPointerCapture(pointerId))$('viewer-stage').releasePointerCapture(pointerId);}
function openViewer(blobOrUrl,alt){closeImageMenu();if(viewerUrl)URL.revokeObjectURL(viewerUrl);viewerSource=blobOrUrl;viewerUrl=blobOrUrl instanceof Blob?URL.createObjectURL(blobOrUrl):null;$('viewer-image').src=viewerUrl||blobOrUrl;$('viewer-image').alt=alt;viewerOffsetX=0;viewerOffsetY=0;viewerScale=1;$('image-viewer').showModal();renderViewer();}
function renderProfiles(){localStorage.setItem(ACTIVE_PROFILE_KEY,profileId);const select=$('profile-select');$('profile-label').textContent=profile().model;$('profile-trigger').setAttribute('aria-label',`使用模型：${profile().model}`);select.replaceChildren(...profiles.map(p=>{const option=document.createElement('button');option.type='button';option.dataset.model=p.id;option.textContent=p.model||'新模型';option.setAttribute('aria-pressed',String(p.id===profileId));return option;}));if(!profile().builtIn){const manage=document.createElement('button');manage.id='manage-profile';manage.type='button';manage.textContent='管理当前自定义模型';manage.setAttribute('aria-haspopup','dialog');manage.setAttribute('aria-controls','model-dialog');select.append(manage);}$('model').value=profile().builtIn?'':profile().model;$('base-url').value=profile().builtIn?'':profile().baseUrl;$('api-key').value=profile().builtIn?'':sessionKeys.get(profileId)||'';renderQuickParams();renderFields();updatePreview();}
function settingGroup(label){const group=document.createElement('div');group.className='setting-group';const heading=document.createElement('div');heading.className='setting-label';heading.textContent=label;group.append(heading);return group;}
function ratioIcon(ratio) {
  const icon=document.createElement('span');
  icon.className='ratio-icon';
  icon.setAttribute('aria-hidden','true');
  const [w,h]=ratio.split(':').map(Number);
  const scale=16/Math.max(w,h);
  if(w&&h){icon.style.setProperty('--ratio-w',`${Math.max(7,w*scale)}px`);icon.style.setProperty('--ratio-h',`${Math.max(7,h*scale)}px`);}
  else icon.dataset.kind=ratio;
  return icon;
}
function updateSettingsSummary() {
  const layout=effectiveLayout(), size=resolveSize(layout);
  const text=layout.ratio==='auto'?'自动':layout.ratio==='custom'?(size.error?'自定义':`${layout.width} × ${layout.height}`):`${layout.ratio} · ${{standard:'标准','2k':'2K','4k':'4K'}[layout.tier]}`;
  const trigger=$('settings-toggle');
  const label=`画面设置：${text}`;
  if (trigger.getAttribute('aria-label') === label) return;
  trigger.replaceChildren(ratioIcon(layout.ratio),document.createTextNode(text));
  trigger.setAttribute('aria-label',label);
}
const chipLabels = new Map(Object.entries({standard:'标准', '2k':'2K', '4k':'4K', auto:'自动', custom:'自定义'}));
function chipGroup(label, values, {kind = '', pill = true} = {}) {
  const node = settingGroup(label);
  const row = document.createElement('div');
  row.className = ['setting-options', kind && `${kind}-options`].filter(Boolean).join(' ');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', label);
  let pick;
  const buttons = values.map(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'setting-chip';
    button.textContent = chipLabels.get(value) ?? value;
    if (kind === 'ratio') button.prepend(ratioIcon(value));
    button.onclick = () => pick(value);
    row.append(button);
    return button;
  });
  node.append(row);
  const highlight = pill ? selectionPill(row) : null;
  return {
    node,
    update(current, onPick, disabled = () => false) {
      pick = onPick;
      let selected = null;
      buttons.forEach((button, index) => {
        const value = values[index];
        const pressed = current === value;
        button.disabled = disabled(value);
        button.classList.toggle('selected', pressed);
        button.setAttribute('aria-pressed', String(pressed));
        if (pressed && !button.disabled && !selected) selected = button;
      });
      highlight?.set(selected);
    },
    destroy: () => highlight?.destroy(),
  };
}

function sizeGroup(custom) {
  const node = settingGroup(custom ? '自定义尺寸' : '尺寸');
  const note = document.createElement('p');
  note.className = 'size-note';
  const updateSize = layout => {
    const size = resolveSize(layout);
    note.textContent = size.error || (size.size === 'auto' ? '自动' : `${size.label} px`);
    note.hidden = custom && !size.error;
    note.dataset.invalid = String(Boolean(size.error));
    updateSettingsSummary();
  };
  const inputs = {};
  if (custom) {
    const line = document.createElement('div');
    line.className = 'custom-size';
    for (const key of ['width', 'height']) {
      const input = inputs[key] = document.createElement('input');
      input.type = 'number'; input.min = '16'; input.max = '3840'; input.step = '16';
      input.placeholder = key === 'width' ? '宽 W' : '高 H';
      input.setAttribute('aria-label', key === 'width' ? '宽度（像素）' : '高度（像素）');
      input.oninput = () => {
        preferences.layout = {...preferences.layout, [key]:input.value};
        savePreferences(); updateSize(effectiveLayout()); updatePreview();
      };
      line.append(input);
    }
    node.append(line);
  }
  node.append(note);
  return {
    node,
    update(layout) {
      for (const [key, input] of Object.entries(inputs)) {
        const value = String(layout[key] || '');
        if (input.value !== value) input.value = value;
      }
      updateSize(layout);
    },
  };
}

function fieldInputGroup(label, field) {
  const node = settingGroup(label);
  const input = document.createElement('input');
  input.className = 'setting-input';
  input.type = field.type === 'number' ? 'number' : 'text';
  if (field.name === 'n') { input.min = '1'; input.max = '10'; input.step = '1'; }
  input.placeholder = '按接口要求填写；留空不发送';
  node.append(input);
  return {
    node,
    update(current, onPick) {
      const value = String(current || '');
      if (input.value !== value) input.value = value;
      input.onchange = () => onPick(input.value);
    },
  };
}

const quickParamGroups = new Map();
const quickParamTitle = document.createElement('div');
quickParamTitle.className = 'settings-heading';
const quickParamEmpty = document.createElement('p');
quickParamEmpty.className = 'setting-empty';
quickParamEmpty.textContent = '这个模型没有公开可读取的画面参数。';
const quickParamLabels = new Map(Object.entries({aspect_ratio:'画面比例', resolution:'分辨率', size:'图片尺寸', quality:'画质', style:'画风', n:'生成数量', response_format:'返回格式'}));
const quickParamPills = new Set(['aspect_ratio', 'resolution', 'quality']);

function renderQuickParams() {
  const wrap = $('quick-params');
  const p = profile();
  const flexible = !!family(p.model) && p.parameterSource !== 'api';
  const fields = p.fields.filter(f => f.name?.trim() && showWorkspaceField(f) && (f.modes === 'both' || f.modes === mode()) && !(flexible && f.name === 'size'));
  const specs = [];
  if (flexible) {
    const layout = effectiveLayout();
    const pick = patch => { preferences.layout = {...layout, ...patch}; savePreferences(); renderQuickParams(); updatePreview(); };
    const noTier = layout.ratio === 'auto' || layout.ratio === 'custom';
    specs.push(
      ['ratio', () => chipGroup('画面比例', RATIOS, {kind:'ratio'}), group => group.update(layout.ratio, value => pick({ratio:value}))],
      ['tier', () => chipGroup('分辨率', TIERS, {kind:'resolution'}), group => group.update(noTier ? null : layout.tier, value => pick({tier:value}), value => noTier || !!resolveSize({...layout, tier:value}).error)],
      [layout.ratio === 'custom' ? 'custom-size' : 'size', () => sizeGroup(layout.ratio === 'custom'), group => group.update(layout)],
    );
  } else if ($('settings-toggle').getAttribute('aria-label') !== '画面设置') {
    $('settings-toggle').innerHTML = iconMarkup('sliders-horizontal') + ' 画面设置';
    $('settings-toggle').setAttribute('aria-label', '画面设置');
  }
  const occurrences = new Map();
  for (const field of fields) {
    const setting = preferenceKey(field);
    const label = quickParamLabels.get(setting) || field.name;
    const options = isQualityField(field) ? qualityOptions(field) : field.type === 'select' ? String(field.options || '').split(',').map(x => x.trim()).filter(Boolean) : [];
    const current = effectiveFieldValue(field);
    const pick = value => {
      field.value = value; rememberField(field); saveProfiles();
      if (options.length) renderQuickParams();
      updatePreview();
    };
    const structure = JSON.stringify([field.name, field.type, options]);
    const index = occurrences.get(structure) || 0;
    occurrences.set(structure, index + 1);
    specs.push([`field:${structure}:${index}`,
      () => options.length ? chipGroup(label, options, {pill:quickParamPills.has(setting)}) : fieldInputGroup(label, field),
      group => group.update(current, pick),
    ]);
  }
  const live = new Set(specs.map(([key]) => key));
  const focused = wrap.contains(document.activeElement) ? document.activeElement : null;
  for (const [key, group] of quickParamGroups) {
    if (live.has(key)) continue;
    group.destroy?.();
    group.node.remove();
    quickParamGroups.delete(key);
  }
  quickParamTitle.textContent = '画面设置 · ' + p.model;
  if (wrap.firstElementChild !== quickParamTitle) wrap.prepend(quickParamTitle);
  if (specs.length) quickParamEmpty.remove();
  else if (!quickParamEmpty.isConnected) wrap.append(quickParamEmpty);
  // Only reconcile structural changes. Same-state renders keep actual focusable nodes (and in-flight pills).
  let previous = quickParamTitle;
  const groups = specs.map(([key, create, update]) => {
    if (!quickParamGroups.has(key)) quickParamGroups.set(key, create());
    const group = quickParamGroups.get(key);
    if (previous.nextElementSibling !== group.node) previous.after(group.node);
    previous = group.node;
    return [group, update];
  });
  for (const [group, update] of groups) update(group);
  if (focused && document.activeElement !== focused && !wrap.inert) {
    (focused.isConnected && !focused.disabled ? focused : $('settings-toggle')).focus({preventScroll:true});
  }
}
function saveFieldEdits(){sanitizeOutput(profile().fields);if(!pendingProfile)saveProfiles();renderQuickParams();updatePreview();}
function fieldControl(field,index,key,label,select=false){const wrap=document.createElement('label');wrap.textContent=label;const input=select?document.createElement('select'):document.createElement('input');if(select)for(const value of key==='type'?['text','number','boolean','select','json']:['both','generate','edit']){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}input.value=field[key]||'';input.onchange=()=>{profile().fields[index][key]=input.value;if(key==='value')rememberField(profile().fields[index]);saveFieldEdits();renderFields();};if(key==='value')input.oninput=()=>{profile().fields[index][key]=input.value;renderQuickParams();updatePreview();};wrap.append(input);return wrap;}
function renderQualityField(field){const wrap=document.createElement('label');wrap.textContent='画质';const select=document.createElement('select');for(const value of qualityOptions(field)){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}select.value=effectiveFieldValue(field);select.onchange=()=>{field.value=select.value;rememberField(field);saveFieldEdits();};wrap.append(select);return wrap;}
function renderFields(){const wrap=$('params');wrap.replaceChildren();profile().fields.forEach((field,i)=>{if(!showWorkspaceField(field))return;const quality=isQualityField(field);const row=document.createElement('div');row.className='param';row.append(fieldControl(field,i,'name','字段名'),quality?renderQualityField(field):fieldControl(field,i,'value','参数值'));const remove=document.createElement('button');remove.className='remove';remove.innerHTML=iconMarkup('x');remove.setAttribute('aria-label','移除参数');remove.onclick=()=>{profile().fields.splice(i,1);saveFieldEdits();renderFields();};row.append(remove);const more=document.createElement('div');more.className='param-settings';if(!quality)more.append(fieldControl(field,i,'type','类型',true));more.append(fieldControl(field,i,'modes','适用模式',true));if(!quality&&field.type==='select')more.append(fieldControl(field,i,'options','选项（逗号分隔）'));row.append(more);wrap.append(row);});}
function params(requestMode=mode()){return workspaceParams(profile(),requestMode,effectiveLayout(),preferences.fields);}
function updatePreview(){try{$('preview').textContent=JSON.stringify({model:profile().builtIn?profile().model:$('model').value,prompt:$('prompt').value,...params()},null,2);}catch(error){$('preview').textContent=error.message;}}
function fileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,data:reader.result,blob:file});reader.onerror=reject;reader.readAsDataURL(file);});}
function renderUploads(){const wrap=$('file-list');wrap.replaceChildren();wrap.hidden=!uploads.length;$('empty-add-image').hidden=!!uploads.length;uploads.forEach((item,i)=>{const card=document.createElement('div');card.className='attachment-card';const preview=document.createElement('button');preview.type='button';preview.className='attachment-preview';preview.title=item.name;preview.setAttribute('aria-label',`查看参考图：${item.name}`);preview.onclick=()=>openViewer(item.blob,item.name);const image=document.createElement('img');image.src=item.data;image.alt='';preview.append(image);const remove=document.createElement('button');remove.type='button';remove.className='attachment-remove';remove.innerHTML=iconMarkup('x');remove.title=`移除${item.name}`;remove.setAttribute('aria-label',`移除${item.name}`);remove.onclick=()=>{uploads.splice(i,1);renderUploads();updatePreview();};card.append(preview,remove);wrap.append(card);});if(uploads.length){const add=document.createElement('button');add.type='button';add.className='attachment-add';add.innerHTML=iconMarkup('image-plus');add.title='继续添加参考图';add.setAttribute('aria-label','继续添加参考图');add.onclick=()=>$('file-input').click();wrap.append(add);}$('mode-hint').textContent=uploads.length?'参考图修改':'图片生成';renderQuickParams();}
async function readParams(){const baseUrl=$('base-url').value.trim(),model=$('model').value.trim();if(!baseUrl||!model){$('discover-status').textContent='请填写 API 地址和模型 ID。';return false;}$('discover-status').textContent='正在读取接口参数…';$('read-params').disabled=true;try{const response=await apiFetch('/api/discover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl,model,apiKey:$('api-key').value.trim()})});const data=await response.json();if(!response.ok)throw Error(data.error);profile().fields=sanitizeOutput(data.fields);profile().parameterSource=data.verified?'api':'official';if(!pendingProfile)saveProfiles();renderFields();renderQuickParams();updatePreview();$('discover-status').textContent=data.source;return true;}catch(error){$('discover-status').textContent=`读取失败：${error.message}`;return false;}finally{$('read-params').disabled=false;}}
async function saveProfile(){const p=profile(),model=$('model').value.trim(),baseUrl=$('base-url').value.trim();if(p.builtIn)return;if(!model||!baseUrl){$('discover-status').textContent='请填写 API 地址和模型 ID。';return;}if(pendingProfile||p.model!==model||p.baseUrl!==baseUrl)await readParams();p.model=model;p.baseUrl=baseUrl;p.name=model;p.layout||={ratio:'auto',tier:'standard'};const key=$('api-key').value.trim();if(key){sessionKeys.set(profileId,key);savedKeys.set(profileId,key);}else{sessionKeys.delete(profileId);savedKeys.delete(profileId);}try{saveProfiles();saveKeys();}catch(error){$('discover-status').textContent=`保存失败：${error.message}`;return;}pendingProfile=false;renderProfiles();$('model-dialog').close();notice((key?'模型和 API Key 已保存到当前浏览器。':'模型已保存，API Key 为空。')+$('discover-status').textContent,true);}
async function imageBlob(src){if(src.startsWith('data:'))return await (await fetch(src)).blob();const response=await apiFetch('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:src})});if(!response.ok){let message=`HTTP ${response.status}`;try{message=(await response.json()).error||message;}catch{}throw Error(message);}return response.blob();}
function setSending(value){busy=value;const button=$('generate');button.disabled=value;button.innerHTML=value?'<span class="send-spinner" aria-hidden="true"></span>':iconMarkup('arrow-up');button.setAttribute('aria-label',value?'正在生成图片':'发送生成请求');}
async function generate(override=null){if(busy)return;let body;const references=override?.references||uploads,requestMode=references.length?'edit':'generate';try{body={baseUrl:profile().builtIn?undefined:profile().baseUrl,apiKey:profile().builtIn?undefined:sessionKeys.get(profileId)||$('api-key').value.trim(),builtinId:profile().builtIn?profile().model:undefined,model:profile().model,prompt:(override?.prompt??$('prompt').value).trim(),mode:requestMode,params:params(requestMode),images:override?[]:references.map(({name,data})=>({name,data}))};if(!profile().builtIn&&!body.apiKey)throw Error('请在模型选择器里打开“管理当前自定义模型”，填写 API Key。');if(!body.prompt)throw Error('请输入画面描述。');}catch(error){notice(error.message);return;}
  const size=family(profile().model)&&profile().parameterSource!=='api'?resolveSize(effectiveLayout()):/^\d+x\d+$/.test(body.params.size||'')?(()=>{const [w,h]=body.params.size.split('x').map(Number);return {ratio:w/h,label:`${w} × ${h}`};})():{ratio:1,label:'自动尺寸'};
  setSending(true);const origin=override?.origin||chat()||createChat(),originId=origin.id;const turn={id:crypto.randomUUID(),prompt:body.prompt,model:body.model,mode:body.mode,references:references.map(x=>({name:x.name,blob:x.blob})),images:[],status:'pending',error:'',aspectRatio:size.ratio,sizeLabel:size.label,createdAt:Date.now()};origin.turns.push(turn);if(origin.turns.length===1&&!origin.manualTitle)origin.title=body.prompt.slice(0,28)||'新聊天';origin.updatedAt=Date.now();renderChatList();if(chatId===originId)renderConversation();const saved=await persistChat(origin).then(()=>true,()=>false);if(!saved)turn.error='这轮对话尚未保存到浏览器。';if(!override){$('prompt').value='';uploads=[];renderUploads();}
  try{if(override&&requestMode==='edit')body.images=await Promise.all(references.map(async ref=>({name:ref.name,data:(await fileData(new File([ref.blob],ref.name||'reference.png',{type:ref.blob.type}))).data})));const response=await apiFetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error||`请求失败：HTTP ${response.status}`);turn.images=await prepareGeneratedPngs(result.images,imageBlob,pngBlob);turn.status='done';}catch(error){turn.status='failed';turn.error=error.message;}finally{origin.updatedAt=Date.now();await persistChat(origin).catch(()=>{});renderChatList();if(chatId===originId)renderConversation();setSending(false);}}
async function connectService(){
  const screen=$('connection-screen'),retry=$('connection-retry'),status=$('connection-status');
  let stopAurora=()=>{};
  try{stopAurora=startAurora($('connection-aurora'));}catch{ /* Keep the static fallback when WebGL cannot start. */ }
  let progress=0,wakeRetry=null,attempt=0;
  const updateProgress=value=>{progress=Math.max(progress,Math.round(value));$('connection-percent').textContent=`${progress}%`;$('connection-percent').setAttribute('aria-valuenow',String(progress));};
  const started=Date.now();
  const progressTimer=setInterval(()=>{const elapsed=Date.now()-started;const target=elapsed<1600?90*(1-Math.pow(1-elapsed/1600,2)):90+5*(1-Math.exp(-(elapsed-1600)/12000));updateProgress(Math.min(95,target));},50);
  const finishProgress=()=>new Promise(resolve=>{const from=progress,start=performance.now(),duration=420;const frame=now=>{const t=Math.min(1,(now-start)/duration);updateProgress(from+(100-from)*(1-Math.pow(1-t,3)));if(t<1)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
  const waitForRetry=delay=>new Promise(resolve=>{const done=()=>{clearTimeout(timer);wakeRetry=null;resolve();};const timer=setTimeout(done,delay);wakeRetry=done;});
  retry.onclick=()=>wakeRetry?.();
  try{
    for(;;){
      retry.hidden=true;
      status.hidden=true;
      status.textContent='';
      try{
        const response=await apiFetch('/api/session',{signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw Error(`服务响应异常（HTTP ${response.status}）`);
        const state=await response.json();
        if(typeof state?.authenticated!=='boolean')throw Error('服务返回的数据无效');
        await new Promise(resolve=>setTimeout(resolve,Math.max(0,2000-(Date.now()-started))));
        clearInterval(progressTimer);
        await finishProgress();
        await new Promise(resolve=>setTimeout(resolve,180));
        screen.classList.add('connection-complete');
        await new Promise(resolve=>setTimeout(resolve,350));
        screen.hidden=true;
        document.querySelector('.app-shell').removeAttribute('inert');
        return state;
      }catch(error){
        attempt++;
        status.textContent='连接失败，请重试';
        status.title=error.message;
        status.hidden=false;
        retry.hidden=false;
        await waitForRetry(Math.min(3000*attempt,15000));
      }
    }
  }finally{clearInterval(progressTimer);stopAurora();}
}
async function init(skipConnection=false){
  const state=skipConnection?{authenticated:true}:await connectService();
  if(!state.authenticated){if(!$('invite-dialog').open)$('invite-dialog').showModal();return;}
  try{chats=await chatStore.list();for(const item of chats){if(!item.turns?.length){chatStore.remove(item.id).catch(()=>{});continue;}let changed=false;for(const turn of item.turns){if(turn.status==='pending'){turn.status='failed';turn.error='页面刷新时请求中断，请重新发送。';changed=true;}}if(changed)persistChat(item).catch(()=>{});}chats=chats.filter(c=>c.turns?.length);}catch(error){notice(`无法读取本地对话：${error.message}`);}if(!chats.length)newChat();else selectChat(chats.some(c=>c.id===localStorage.getItem(ACTIVE_CHAT_KEY))?localStorage.getItem(ACTIVE_CHAT_KEY):chats[0].id);renderProfiles();}

$('new-chat').onclick=newChat;
$('sidebar-toggle').onclick=()=>setSidebar(!document.body.classList.contains('sidebar-open'));
$('desktop-sidebar-toggle').onclick=()=>{
  const collapsed = !document.body.classList.contains('rail-collapsed');
  localStorage.setItem(railStorageKey, String(collapsed));
  closeSidebarPopovers();
  setRailCollapsed(collapsed);
};
const historyContains=node=>historyActions?.trigger.contains(node) || historyActions?.panel.contains(node);
for(const type of ['pointerdown','focusin']) document.addEventListener(type,event=>{
  if(historyActions && !historyContains(event.target))closeHistoryActions();
});
$('chat-list').addEventListener('keydown',event=>{
  if(event.key!=='Escape' || !historyActions)return;
  event.preventDefault();
  event.stopPropagation();
  closeHistoryActions(true);
});
$('chat-list').addEventListener('scroll',()=>closeHistoryActions(historyActions?.panel.contains(document.activeElement)),{passive:true});
window.addEventListener('resize',()=>closeHistoryActions(historyActions?.panel.contains(document.activeElement)));
mobileSidebar.addEventListener('change',syncSidebarLayout);
syncSidebarLayout();
$('sidebar-shade').onclick=closeSidebar;
$('cancel-delete').onclick=()=>$('confirm-dialog').close();
$('confirm-delete').onclick=async()=>{const id=pendingDelete;pendingDelete=null;$('confirm-dialog').close();try{await chatStore.remove(id);}catch(error){notice(`删除失败：${error.message}`);return;}chats=chats.filter(c=>c.id!==id);if(chatId===id){if(!chats.length)newChat();else selectChat(chats[0].id);}else renderChatList();};
const modelPicker = $('profile-picker');
const modelTrigger = $('profile-trigger');
$('profile-select').onclick = event => {
  if (event.target.closest('#manage-profile')) {
    modelPicker.open = false;
    modelTrigger.focus({preventScroll:true});
    $('dialog-title').textContent='管理自定义模型';
    $('discover-status').textContent='';
    $('model-dialog').showModal();
    return;
  }
  const option = event.target.closest('button[data-model]');
  if (!option) return;
  modelPicker.open = false;
  if(!profile().builtIn)sessionKeys.set(profileId,$('api-key').value);
  profileId = option.dataset.model;
  renderProfiles();
  modelTrigger.focus({preventScroll:true});
};
modelPicker.addEventListener('toggle', () => {
  if (modelPicker.open) setQuickSettings(false);
});
modelPicker.addEventListener('keydown', event => {
  if (event.key === 'Escape' && modelPicker.open) {
    event.stopPropagation();
    modelPicker.open = false;
    modelTrigger.focus({preventScroll:true});
    return;
  }
  if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
  event.preventDefault();
  modelPicker.open = true;
  const items = [...$('profile-select').querySelectorAll('button')];
  const index = items.indexOf(document.activeElement);
  const next = event.key==='Home' ? 0 : event.key==='End' ? items.length-1 : index<0 ? items.findIndex(item=>item.getAttribute('aria-pressed')==='true') : (index+items.length+(event.key==='ArrowDown'?1:-1))%items.length;
  items[next]?.focus({preventScroll:true});
});
document.addEventListener('pointerdown', event => {
  if (modelPicker.open && !modelPicker.contains(event.target)) modelPicker.open = false;
});
modelPicker.addEventListener('focusout', event => {
  if (event.relatedTarget && !modelPicker.contains(event.relatedTarget)) modelPicker.open = false;
});
$('export-backup').onclick=async()=>{closeAccountMenu();try{notice('正在整理对话和图片…');const settings={profiles:profiles.filter(p=>!p.builtIn).map(({id,model,baseUrl,fields,parameterSource,layout})=>({id,model,baseUrl,fields,parameterSource,layout})),preferences};const backup=await createBackup(await chatStore.list(),settings,imageBlob);const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`rayai-backup-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);notice('备份已下载。请妥善保管，其中包含你的对话和图片。',true);}catch(error){notice(`导出失败：${error.message}`);}};
$('import-backup').onclick=()=>{closeAccountMenu();$('backup-file').click();};
$('backup-file').onchange=async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;try{const backup=readBackup(await file.text());const existing=new Map((await chatStore.list()).map(item=>[item.id,item]));let count=0;for(const item of backup.chats){if(!existing.has(item.id)||item.updatedAt>existing.get(item.id).updatedAt){await chatStore.save(item);existing.set(item.id,item);count++;}}const incoming=Array.isArray(backup.settings.profiles)?backup.settings.profiles:[];const current=new Map(profiles.filter(p=>!p.builtIn).map(p=>[p.id,p]));for(const p of incoming){if(typeof p?.id==='string'&&typeof p.model==='string'&&typeof p.baseUrl==='string'&&!String(p.id).startsWith('builtin:'))current.set(p.id,{...p,fields:sanitizeOutput(p.fields||[])});}profiles=[...builtinProfiles(),...current.values()];saveProfiles();const imported=backup.settings.preferences;if(imported?.layout&&imported?.fields){preferences.layout=imported.layout;preferences.fields=imported.fields;savePreferences();}chats=[...existing.values()].sort((a,b)=>b.updatedAt-a.updatedAt);if(chats.length)selectChat(chats[0].id);else newChat();renderProfiles();notice(`导入完成：新增或更新 ${count} 个对话。自定义模型密钥需重新填写。`,true);}catch(error){notice(`导入失败：${error.message}`);}};
$('invite-dialog').addEventListener('cancel',e=>e.preventDefault());
$('invite-form').onsubmit=async e=>{e.preventDefault();const code=$('invite-code').value.trim();$('invite-error').textContent='';try{const response=await apiFetch('/api/invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const data=await response.json();if(!response.ok)throw Error(data.error||'邀请码无效');rememberInvite(data);$('invite-code').value='';$('invite-dialog').close();await init(true);}catch(error){$('invite-error').textContent=error.message;}};
$('close-dialog').onclick=()=>$('model-dialog').close();
$('model-dialog').addEventListener('close',()=>{if(pendingProfile){profiles=profiles.filter(p=>p.id!==profileId);profileId=profiles[0].id;pendingProfile=false;renderProfiles();}});
$('save-profile').onclick=saveProfile;$('read-params').onclick=readParams;
$('delete-profile').onclick=()=>{if(profile().builtIn)return;sessionKeys.delete(profileId);savedKeys.delete(profileId);profiles=profiles.filter(p=>p.id!==profileId);profileId=profiles[0].id;pendingProfile=false;saveProfiles();saveKeys();renderProfiles();$('model-dialog').close();notice('模型和密钥已删除。',true);};
$('toggle-key').onclick=()=>{const input=$('api-key');input.type=input.type==='password'?'text':'password';$('toggle-key').textContent=input.type==='password'?'显示':'隐藏';};
$('add-field').onclick=()=>{profile().fields.push({name:'',type:'text',value:'',options:'',modes:'both'});saveFieldEdits();renderFields();};
const settingsToggle=$('settings-toggle'),quickSettings=$('quick-params');
document.body.append(quickSettings);
settingsToggle.setAttribute('aria-owns','quick-params');
settingsToggle.addEventListener('keydown',event=>{
  if(event.key==='Tab'&&!event.shiftKey&&!quickSettings.inert){
    const first=quickSettings.querySelector('button:not(:disabled), input:not(:disabled)');
    if(first){event.preventDefault();first.focus();}
  }
});
quickSettings.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const items=[...quickSettings.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
  if((event.shiftKey&&document.activeElement===items[0])||(!event.shiftKey&&document.activeElement===items.at(-1))){
    event.preventDefault();setQuickSettings(false,true);
  }
});
function positionQuickSettings(){
  if(quickSettings.inert)return;
  const viewport=window.visualViewport;
  const x=viewport?.offsetLeft||0,y=viewport?.offsetTop||0;
  const w=viewport?.width||innerWidth,h=viewport?.height||innerHeight;
  const trigger=settingsToggle.getBoundingClientRect();
  const gap=8,edge=12,width=Math.min(552,w-2*edge);
  const below=y+h-edge-trigger.bottom-gap,above=trigger.top-y-edge-gap;
  const empty=paramWorkspace.classList.contains('is-empty');
  const openBelow=below>=Math.min(empty?240:360,quickSettings.scrollHeight)||below>=above;
  const height=Math.max(64,openBelow?below:above);
  const left=Math.min(x+w-edge-width,Math.max(x+edge,trigger.left));
  Object.assign(quickSettings.style,{left:`${left}px`,width:`${width}px`,maxHeight:`${height}px`,top:openBelow?`${trigger.bottom+gap}px`:'auto',bottom:openBelow?'auto':`${innerHeight-trigger.top+gap}px`});
  quickSettings.dataset.side=openBelow?'below':'above';
}
function setQuickSettings(open,restoreFocus=false){
  if(quickSettings.inert===!open)return;
  if(!open&&(restoreFocus||quickSettings.contains(document.activeElement)))settingsToggle.focus({preventScroll:true});
  quickSettings.inert=!open;
  quickSettings.classList.toggle('is-open',open);
  settingsToggle.setAttribute('aria-expanded',String(open));
  if(open)positionQuickSettings();
}
window.addEventListener('resize',positionQuickSettings);
window.addEventListener('scroll',positionQuickSettings,true);
window.visualViewport?.addEventListener('resize',positionQuickSettings);
window.visualViewport?.addEventListener('scroll',positionQuickSettings);
new ResizeObserver(positionQuickSettings).observe(settingsToggle);
const paramWorkspace=document.querySelector('.chat-workspace');
new ResizeObserver(positionQuickSettings).observe(paramWorkspace);
settingsToggle.onclick=()=>setQuickSettings(quickSettings.inert);
document.addEventListener('pointerdown',event=>{if(!quickSettings.contains(event.target)&&!settingsToggle.contains(event.target))setQuickSettings(false);});
document.addEventListener('pointerdown',event=>{if(!$('image-menu').contains(event.target))closeImageMenu();});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  if(!quickSettings.inert)setQuickSettings(false,true);
  else if(!$('image-menu').hidden)closeImageMenu();
  else if(!document.querySelector('dialog[open]'))closeSidebar();
});
window.addEventListener('rayai-auth-expired',()=>{notice('邀请码已失效，请重新输入。');if(!$('invite-dialog').open)$('invite-dialog').showModal();});
$('image-menu').addEventListener('click',async event=>{const action=event.target.closest('button')?.dataset.action,source=contextImage;if(!action||!source)return;closeImageMenu();try{await performImageMenu(action,source);}catch(error){notice(`${action==='copy'?'复制':action==='attach'?'添加':'下载'}图片失败：${error.message}`);}});
async function addFiles(files){for(const file of files){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024){notice(`${file.name||'图片'}格式不支持或超过 20 MB`);continue;}uploads.push(await fileData(file));}renderUploads();updatePreview();}
$('file-input').onchange=async e=>{await addFiles([...e.target.files]);e.target.value='';};
$('empty-add-image').onclick=()=>$('file-input').click();
$('prompt').addEventListener('paste',e=>{const files=[...(e.clipboardData?.items||[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(!files.length)return;e.preventDefault();addFiles(files).catch(error=>notice(`粘贴图片失败：${error.message}`));});
$('prompt').oninput=updatePreview;$('model').oninput=updatePreview;$('generate').onclick=()=>generate();
$('prompt').onkeydown=e=>{if(e.key!=='Enter'||e.shiftKey||e.altKey||e.isComposing||e.keyCode===229)return;e.preventDefault();generate();};
$('viewer-close').onclick=()=>$('image-viewer').close();$('viewer-reset').onclick=()=>setViewerScale(1);
$('viewer-stage').addEventListener('wheel',e=>{e.preventDefault();setViewerScale(viewerScale*(e.deltaY<0?1.12:1/1.12));},{passive:false});
$('viewer-image').addEventListener('load',renderViewer);
$('viewer-image').draggable=false;
$('viewer-image').addEventListener('dragstart',e=>e.preventDefault());
$('viewer-image').addEventListener('contextmenu',e=>{e.preventDefault();if(suppressViewerContextMenu||viewerPan?.moved)return;showImageMenu(e,viewerSource);});
$('viewer-stage').addEventListener('contextmenu',e=>e.preventDefault());
$('viewer-stage').addEventListener('pointerdown',e=>{if(![0,2].includes(e.button)||e.target!==$('viewer-image')||!$('viewer-stage').classList.contains('can-pan'))return;e.preventDefault();closeImageMenu();viewerPan={pointerId:e.pointerId,button:e.button,startX:e.clientX,startY:e.clientY,offsetX:viewerOffsetX,offsetY:viewerOffsetY,moved:false};$('viewer-stage').setPointerCapture(e.pointerId);});
$('viewer-stage').addEventListener('pointermove',e=>{if(!viewerPan||e.pointerId!==viewerPan.pointerId)return;const dx=e.clientX-viewerPan.startX,dy=e.clientY-viewerPan.startY;if(!viewerPan.moved&&Math.hypot(dx,dy)<3)return;if(!viewerPan.moved){viewerPan.moved=true;closeImageMenu();$('viewer-stage').classList.add('panning');}viewerOffsetX=viewerPan.offsetX+dx;viewerOffsetY=viewerPan.offsetY+dy;renderViewer();});
$('viewer-stage').addEventListener('pointerup',e=>{if(viewerPan?.pointerId!==e.pointerId)return;const {button,moved}=viewerPan;if(moved){if(button===0){suppressViewerClick=true;setTimeout(()=>suppressViewerClick=false,150);}else{suppressViewerContextMenu=true;setTimeout(()=>suppressViewerContextMenu=false,250);}}stopViewerPan();if(button===2&&!moved)showImageMenu(e,viewerSource);});
$('viewer-stage').addEventListener('pointercancel',stopViewerPan);
$('viewer-stage').addEventListener('lostpointercapture',stopViewerPan);
$('image-viewer').addEventListener('click',e=>{if(suppressViewerClick){suppressViewerClick=false;return;}if(e.button!==0||e.target===$('viewer-image')||e.target.closest('button'))return;$('image-viewer').close();});
$('image-viewer').addEventListener('close',()=>{closeImageMenu();stopViewerPan();viewerSource=null;viewerOffsetX=0;viewerOffsetY=0;viewerScale=1;if(viewerUrl){URL.revokeObjectURL(viewerUrl);viewerUrl=null;}});
window.addEventListener('resize',()=>{if($('image-viewer').open)renderViewer();});
init().then(()=>{document.documentElement.dataset.appReady='true';}).catch(error=>notice(`页面初始化失败：${error.message}`));
