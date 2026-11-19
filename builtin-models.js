export const builtinModels=['gpt-image-2.6-sunburst','gpt-image-2.5-sunburst','gpt-image-2'];
const keyByModel={
  'gpt-image-2.6-sunburst':'MUZE_API_KEY',
  'gpt-image-2.5-sunburst':'MUZE_API_KEY_IMAGE_2_5',
  'gpt-image-2':'MUZE_API_KEY_IMAGE_2',
};
export function applyBuiltin(input,env){
  if(!input?.builtinId)return input;
  if(!builtinModels.includes(input.builtinId))throw Object.assign(new Error('未知的内置模型'),{status:400});
  const apiKey=env[keyByModel[input.builtinId]];
  if(!apiKey)throw Object.assign(new Error('所选内置模型暂未配置密钥，请稍后再试'),{status:503});
  return {...input,model:input.builtinId,baseUrl:env.MUZE_BASE_URL||'https://api.muzeai.top/v1',apiKey};
}
