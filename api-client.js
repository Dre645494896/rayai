const TOKEN_KEY='rayai-invite-session-v1';
const configuredBase=String(globalThis.RAYAI_API_BASE||'').replace(/\/+$/,'');
const remote=!!configuredBase;

export function apiBase(){return configuredBase;}

function savedToken(){
  try{
    const value=JSON.parse(localStorage.getItem(TOKEN_KEY));
    if(value?.token&&value.expiresAt>Date.now())return value.token;
  }catch{}
  localStorage.removeItem(TOKEN_KEY);
  return null;
}

export function rememberInvite(result){
  if(!remote)return;
  if(typeof result?.token!=='string'||!Number.isFinite(result.expiresAt))throw Error('服务端未返回有效的访问凭证');
  localStorage.setItem(TOKEN_KEY,JSON.stringify({token:result.token,expiresAt:result.expiresAt}));
}

export async function apiFetch(path,options={}){
  if(!/^\/api\/[a-z-]+$/.test(path))throw Error('无效的接口路径');
  if(!remote&&location.hostname.endsWith('.github.io'))throw Error('生图服务尚未配置，请稍后再试');
  const headers=new Headers(options.headers||{});
  if(remote&&path!=='/api/invite'){
    const token=savedToken();
    if(token)headers.set('Authorization',`Bearer ${token}`);
  }
  const response=await fetch(`${configuredBase}${path}`,{...options,headers,signal:options.signal||AbortSignal.timeout(240000)});
  if(remote&&response.status===401){localStorage.removeItem(TOKEN_KEY);dispatchEvent(new Event('rayai-auth-expired'));}
  return response;
}
