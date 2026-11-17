export const RATIOS = ['auto','1:1','3:2','2:3','4:3','3:4','16:9','9:16','21:9','9:21','custom'];
export const TIERS = ['standard','2k','4k'];
export function family(model) {
  if (/^gpt-image-2\.6-(sunburst|flare)$/.test(model)) return '2.6';
  if (/^gpt-image-2\.5-(sunburst|flare)(-2026-09-08)?$/.test(model)) return '2.5';
  if (/^gpt-image-2(-2026-04-21)?$/.test(model)) return '2';
  return null;
}
export function officialFields(model) {
  const version=family(model); if(!version)return null;
  const fields=[
    {name:'size',type:'text',options:'',value:'auto',modes:'both'},
    {name:'quality',type:'select',options:version==='2'?'auto,low,medium,high':'auto,low,medium,high,xhigh,max',value:'auto',modes:'both'},
    {name:'output_format',type:'select',options:'png,jpeg',value:'png',modes:'both'}
  ];
  if(version==='2.6')fields.splice(2,0,{name:'complexity',type:'select',options:'low,medium,high',value:'high',modes:'both'});
  return fields;
}
export function sanitizeOutput(fields) {
  for(const field of fields||[]){if(field.name!=='output_format')continue;field.options=String(field.options||'').split(',').map(x=>x.trim()).filter(x=>x&&x!=='webp').join(',');if(field.value==='webp')field.value=field.options.split(',').includes('png')?'png':field.options.split(',')[0]||'';}
  return fields;
}
const round16=value=>Math.max(16,Math.round(value/16)*16);
export function validateSize(width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width%16||height%16)return '宽高必须是 16 的倍数';
  if(width>3840||height>3840||width<=0||height<=0)return '宽高须在 16–3840 像素之间';
  if(Math.max(width,height)/Math.min(width,height)>3)return '画面比例不能超过 3:1';
  if(width*height<655360||width*height>8294400)return '总像素须在 655,360–8,294,400 之间';
  return null;
}
export function resolveSize(layout) {
  if(!layout||layout.ratio==='auto')return {size:'auto',ratio:1,label:'自动尺寸'};
  if(layout.ratio==='custom'){
    const width=Number(layout.width),height=Number(layout.height),error=validateSize(width,height);
    return error?{error}:{size:`${width}x${height}`,ratio:width/height,label:`${width} × ${height}`};
  }
  const [a,b]=layout.ratio.split(':').map(Number);if(!a||!b)return {error:'画面比例无效'};
  const long=layout.tier==='4k'?3840:layout.tier==='2k'?2048:Math.max(1024,Math.ceil(Math.sqrt(655360*Math.max(a,b)/Math.min(a,b))/16)*16+16);
  const width=round16(a>=b?long:long*a/b),height=round16(a>=b?long*b/a:long);
  const error=validateSize(width,height);
  return error?{error}:{size:`${width}x${height}`,ratio:width/height,label:`${width} × ${height}`};
}
