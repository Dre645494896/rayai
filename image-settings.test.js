import test from 'node:test';
import assert from 'node:assert/strict';
import { family, officialFields, builtinFields, sanitizeOutput, resolveSize, RATIOS, TIERS } from './image-settings.js';

test('两个新增内置模型使用接口文档中的文生图默认值', () => {
  for (const model of ['gpt-image-2','gpt-image-2.5-sunburst']) {
    assert.deepEqual(Object.fromEntries(builtinFields(model).map(f=>[f.name,f.value])), {
      size:'1024x1024',quality:'standard',style:'vivid',n:'1',response_format:'url'
    });
    assert.ok(builtinFields(model).every(f=>f.modes==='generate'));
  }
});

test('各 GPT Image 系列使用对应画质和细节选项', () => {
  assert.equal(family('gpt-image-2.6-sunburst'), '2.6');
  assert.equal(family('gpt-image-2.5-flare'), '2.5');
  assert.deepEqual(officialFields('gpt-image-2').find(f => f.name === 'quality').options.split(','), ['auto','low','medium','high']);
  assert.ok(officialFields('gpt-image-2.6-flare').some(f => f.name === 'complexity'));
  assert.ok(!officialFields('gpt-image-2.5-sunburst').some(f => f.name === 'complexity'));
});

test('旧 WebP 输出配置改为 PNG，参考图格式不受影响', () => {
  const fields=sanitizeOutput([{name:'output_format',type:'select',options:'png,jpeg,webp',value:'webp'}]);
  assert.equal(fields[0].options,'png,jpeg');
  assert.equal(fields[0].value,'png');
});

test('常用比例产生可发送的尺寸，过大组合由页面禁用', () => {
  for(const ratio of RATIOS.filter(x=>x!=='auto'&&x!=='custom')) {
    const size=resolveSize({ratio,tier:'standard'});
    assert.match(size.size,/^\d+x\d+$/,ratio);
    assert.ok(Math.abs(size.ratio-ratio.split(':')[0]/ratio.split(':')[1])<.02,ratio);
    for(const tier of TIERS){
      const option=resolveSize({ratio,tier});
      assert.ok(option.size||option.error,`${ratio} ${tier}`);
    }
  }
  assert.match(resolveSize({ratio:'1:1',tier:'4k'}).error,/总像素/);
  assert.equal(resolveSize({ratio:'auto',tier:'standard'}).label,'自动尺寸');
});

test('自定义宽高必须符合模型尺寸约束', () => {
  assert.equal(resolveSize({ratio:'custom',width:1536,height:1024}).size,'1536x1024');
  assert.match(resolveSize({ratio:'custom',width:1535,height:1024}).error,/16/);
  assert.match(resolveSize({ratio:'custom',width:3840,height:3840}).error,/总像素/);
});
