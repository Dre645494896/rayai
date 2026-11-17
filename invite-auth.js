const cookieName='rayai_invite';
const days=30*24*60*60;
const bytes=value=>new TextEncoder().encode(value);
const hex=buffer=>[...new Uint8Array(buffer)].map(x=>x.toString(16).padStart(2,'0')).join('');
const b64=value=>btoa(String.fromCharCode(...bytes(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=value=>new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));
function codes(env){try{const value=JSON.parse(env.INVITE_CODES||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
async function digest(code){return hex(await crypto.subtle.digest('SHA-256',bytes(code)));}
async function signature(value,secret){const key=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,bytes(value)));}
export async function redeemInvite(code,env){if(!env.INVITE_SESSION_SECRET||typeof code!=='string'||!code||code.length>256)return null;const hash=await digest(code);const entry=Object.entries(codes(env)).find(([,value])=>value===hash);if(!entry)return null;const expiresAt=Date.now()+days*1000;const payload=b64(JSON.stringify({id:entry[0],exp:expiresAt}));const token=`${payload}.${await signature(payload,env.INVITE_SESSION_SECRET)}`;return {cookie:`${cookieName}=${token}; Path=/; Max-Age=${days}; HttpOnly; Secure; SameSite=Lax`,token,expiresAt,id:entry[0]};}
export async function inviteIdentity(request,env,localDev=false){if(localDev&&!env.INVITE_CODES&&!env.INVITE_SESSION_SECRET)return 'local-dev';if(!env.INVITE_SESSION_SECRET)return null;const bearer=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];const token=bearer||request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);if(!token)return null;const [payload,mac]=token.split('.');if(!payload||!mac)return null;try{const expected=await signature(payload,env.INVITE_SESSION_SECRET);if(expected!==mac)return null;const data=JSON.parse(unb64(payload));return data.exp>Date.now()&&Object.hasOwn(codes(env),data.id)?data.id:null;}catch{return null;}}
export const hashInvite=digest;
