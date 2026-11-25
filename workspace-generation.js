import { family, resolveSize } from './image-settings.js';

const QUALITIES = ['medium', 'high', 'max'];
const PNG_TYPE = 'image/png';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export const isQualityField = field => field.name?.trim().toLowerCase() === 'quality';
const optionsFor = field => String(field.options || '').split(',').map(value => value.trim()).filter(Boolean);
export function qualityOptions(field) {
  if (field.type !== 'select') return [];
  const declared = optionsFor(field);
  return QUALITIES.filter(value => declared.includes(value));
}

export function workspaceBuiltinFields() {
  return [
    {name:'size', type:'text', options:'', value:'auto', modes:'both'},
    {name:'quality', type:'select', options:QUALITIES.join(','), value:'medium', modes:'both'},
  ];
}

export function showWorkspaceField(field) {
  const name = field.name?.trim().toLowerCase();
  if (name === 'complexity' || name === 'output_format') return false;
  return !isQualityField(field) || qualityOptions(field).length > 0;
}

export function workspaceFieldValue(field, remembered) {
  if (isQualityField(field)) {
    const options = qualityOptions(field);
    if (options.includes(remembered?.value) && remembered.type === field.type) return remembered.value;
    if (options.includes(field.value)) return field.value;
    return options.includes('medium') ? 'medium' : options[0];
  }
  if (!remembered || remembered.type !== field.type) return field.value;
  const options = optionsFor(field);
  return options.length && !options.includes(remembered.value) ? field.value : remembered.value;
}

export function workspaceParams(profile, requestMode, layout, preferences) {
  const result = {output_format:'png'};
  for (const field of profile.fields) {
    if ((field.modes !== 'both' && field.modes !== requestMode) || !showWorkspaceField(field)) continue;
    const name = isQualityField(field) ? 'quality' : field.name?.trim();
    const raw = String(workspaceFieldValue(field, preferences[isQualityField(field) ? 'quality' : field.name]) ?? '').trim();
    if (!name || !raw) continue;
    if (['model','prompt','image','image[]'].includes(name)) throw Error(`${name} 是保留字段`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw Error(`字段名无效：${name}`);
    if (Object.hasOwn(result,name)) throw Error(`参数重复：${name}`);
    if (field.type === 'select' && field.options && !optionsFor(field).includes(raw)) throw Error(`${name} 的值不在选项中`);
    if (field.type === 'number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw Error(`${name} 必须是数字`);
      result[name] = value;
    } else if (field.type === 'boolean') {
      if (!['true','false'].includes(raw)) throw Error(`${name} 必须是 true 或 false`);
      result[name] = raw === 'true';
    } else if (field.type === 'json') {
      try { result[name] = JSON.parse(raw); } catch { throw Error(`${name} 的 JSON 格式无效`); }
    } else result[name] = raw;
  }
  if (family(profile.model) && profile.parameterSource !== 'api') {
    const size = resolveSize(layout);
    if (size.error) throw Error(size.error);
    result.size = size.size;
  }
  return result;
}

async function hasPngSignature(blob) {
  const bytes = new Uint8Array(await blob.slice(0, PNG_SIGNATURE.length).arrayBuffer());
  return PNG_SIGNATURE.every((byte,index) => bytes[index] === byte);
}

export async function prepareGeneratedPngs(sources, download, convert) {
  try {
    if (!Array.isArray(sources) || !sources.length) throw Error('没有收到图片');
    const images = [];
    for (const source of sources) {
      const downloaded = await download(source);
      if (await hasPngSignature(downloaded)) {
        images.push(downloaded.type === PNG_TYPE ? downloaded : downloaded.slice(0, downloaded.size, PNG_TYPE));
        continue;
      }
      // Inline base64 results may be labeled using the requested format rather than their actual bytes.
      const input = downloaded.type === PNG_TYPE ? downloaded.slice() : downloaded;
      const png = await convert(input);
      if (png?.type !== PNG_TYPE || !await hasPngSignature(png)) throw Error('图片转换未返回有效的 PNG');
      images.push(png);
    }
    return images;
  } catch (error) {
    throw Error(`图片已生成，但无法保存为 PNG：${error.message}`, {cause:error});
  }
}
