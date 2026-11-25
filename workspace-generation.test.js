import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareGeneratedPngs, qualityOptions, showWorkspaceField, workspaceBuiltinFields, workspaceFieldValue, workspaceParams } from './workspace-generation.js';

const layout = {ratio:'auto', tier:'standard'};
const quality = (options, value, modes='both') => ({name:'quality', type:'select', options, value, modes});
const preference = value => ({quality:{type:'select', value}});

test('workspace built-ins offer medium, high and max, defaulting to medium in both modes', () => {
  for (const model of ['gpt-image-2.6-sunburst', 'gpt-image-2.5-sunburst', 'gpt-image-2']) {
    const profile = {model, fields:workspaceBuiltinFields()};
    assert.deepEqual(qualityOptions(profile.fields.find(field => field.name==='quality')), ['medium', 'high', 'max']);
    for (const mode of ['generate', 'edit']) {
      assert.deepEqual(workspaceParams(profile, mode, layout, preference('auto')), {quality:'medium', output_format:'png', size:'auto'});
      for (const value of ['medium', 'high', 'max']) {
        assert.equal(workspaceParams(profile, mode, layout, preference(value)).quality, value);
      }
    }
  }
});

test('custom quality only uses declared supported options and picks a valid fallback', () => {
  const generate = quality(' auto, low, high, xhigh, max,high ', 'max', 'generate');
  const edit = quality('low, medium, high, ultra', 'low', 'edit');
  const profile = {model:'custom', fields:[generate, edit]};
  assert.deepEqual(qualityOptions(generate), ['high', 'max']);
  assert.deepEqual(qualityOptions(edit), ['medium', 'high']);
  assert.equal(workspaceFieldValue(generate, preference('medium').quality), 'max');
  assert.equal(workspaceFieldValue(quality('low,max', 'low'), preference('high').quality), 'max');
  assert.deepEqual(workspaceParams(profile, 'generate', layout, preference('high')), {quality:'high', output_format:'png'});
  assert.deepEqual(workspaceParams(profile, 'edit', layout, preference('max')), {quality:'medium', output_format:'png'});
});

test('unsupported custom quality, legacy complexity and format stay hidden and unsent', () => {
  const fields = [quality('auto, low, xhigh, ultra', 'low'), {...quality('', 'high'), type:'text'},
    {...quality('low,high', 'high'), name:' Complexity '},
    {...quality('jpeg,webp', 'jpeg'), name:'output_format'},
    {...quality('jpeg', 'jpeg'), name:' OUTPUT_FORMAT '}];
  assert.ok(fields.every(field => !showWorkspaceField(field)));
  const n = {name:'n', type:'number', value:'2', modes:'both'};
  assert.deepEqual(workspaceParams({model:'custom', fields:[...fields, n]}, 'generate', layout, preference('max')), {output_format:'png', n:2});
});

const pngData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=', 'base64');
const png = new Blob([pngData], {type:'image/png'});
const jpeg = new Blob([Uint8Array.of(255, 216, 255, 224)], {type:'image/jpeg'});
const mislabeled = new Blob([jpeg], {type:'image/png'});
const webp = new Blob(['RIFFxxxxWEBPVP8 '], {type:'image/webp'});

test('new image collection passes through PNGs and encodes JPEG/WebP after download', async () => {
  const results = [png, jpeg, webp, mislabeled, new Blob([pngData])];
  const conversions = [];
  const images = await prepareGeneratedPngs([0,1,2,3,4], index => results[index], async input => {
    conversions.push(input.type);
    return png;
  });
  assert.deepEqual(conversions, ['image/jpeg', 'image/webp', '']);
  assert.equal(images[0], png);
  for (const image of images) {
    assert.equal(image.type, 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), pngData);
  }
  assert.equal(mislabeled.type, 'image/png');
});

test('PNG preparation rejects the whole result on download or conversion failure', async () => {
  const fail = () => { throw Error('下载失败'); };
  await assert.rejects(prepareGeneratedPngs(['url'], fail, () => png), /无法保存为 PNG：下载失败/);
  await assert.rejects(prepareGeneratedPngs([0,1], index => [png,jpeg][index], () => mislabeled), /无法保存为 PNG：图片转换未返回有效的 PNG/);
  await assert.rejects(prepareGeneratedPngs(['url'], () => webp, () => null), /无法保存为 PNG/);
});
