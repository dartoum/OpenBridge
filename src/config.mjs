import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const legacySelections = { sonnet:'claude/sonnet', opus:'claude/opus', haiku:'claude/haiku', codex:'chatgpt/default', 'gemini-auto':'google/gemini-3.8-flash-medium', 'gemini-pro':'google/gemini-4-argon-medium', 'gemini-flash':'google/gemini-3.8-flash-medium', commandcode:'commandcode/deepseek/deepseek-v4-flash' };
const model = (provider, upstreamModel, name) => ({ id:`${provider}/${upstreamModel}`, upstreamModel, name, enabled:true });
export function defaultConfig() {
  return { version:1, selectedModel:'claude/sonnet', providers:[
    { id:'claude', name:'Claude Pro', type:'claude', enabled:true, cliPath:process.env.CLAUDE_BIN || join(homedir(),'.local/bin/claude'), baseURL:'', models:[model('claude','sonnet','Sonnet'),model('claude','opus','Opus'),model('claude','haiku','Haiku')] },
    { id:'chatgpt', name:'ChatGPT', type:'codex', enabled:true, cliPath:process.env.CODEX_BIN || join(homedir(),'.local/bin/codex'), baseURL:'', models:[model('chatgpt','default','Codex · default model')] },
    { id:'google', name:'Google AI Pro', type:'antigravity', enabled:true, cliPath:process.env.AGY_BIN || join(homedir(),'.local/bin/agy'), baseURL:'', models:[model('google','gemini-3.8-flash-medium','Gemini 3.8 Flash (Medium)'),model('google','gemini-4-argon-medium','Gemini 4 Argon (Medium)')] },
    { id:'commandcode', name:'Command Code GOAT', type:'openai', enabled:true, cliPath:'', baseURL:'https://api.commandcode.ai/provider/v1', models:[model('commandcode','deepseek/deepseek-v4-flash','DeepSeek V4 Flash')] },
  ] };
}
export function catalog(config) { return config.providers.flatMap(provider=>provider.models.map(model=>({ ...model, providerID:provider.id, providerName:provider.name, providerType:provider.type, enabled:provider.enabled && model.enabled }))); }
export function validBaseURL(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw Error('Endpoint must not contain credentials, query or fragment');
  if (url.protocol !== 'https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw Error('Use HTTPS, or HTTP on localhost');
  return value.replace(/\/$/,'');
}
export function validateConfig(value) {
  if (!value || value.version!==1 || !Array.isArray(value.providers) || value.providers.length>50) throw Error('Invalid configuration');
  const providers = new Set(), models = new Set();
  for (const p of value.providers) {
    if (!p || !/^[a-z][a-z0-9-]{0,50}$/.test(p.id) || providers.has(p.id) || typeof p.name!=='string' || !p.name.trim() || p.name.length>120 || !['claude','codex','antigravity','openai'].includes(p.type) || typeof p.enabled!=='boolean' || !Array.isArray(p.models) || p.models.length>300 || typeof p.cliPath!=='string' || typeof p.baseURL!=='string') throw Error('Invalid provider');
    providers.add(p.id);
    if (Object.keys(p).some(k=>!['id','name','type','enabled','cliPath','baseURL','models'].includes(k))) throw Error('Unknown provider field; credentials belong in Keychain');
    if (p.type==='openai') p.baseURL=validBaseURL(p.baseURL);
    else if (!p.cliPath.startsWith('/') || p.cliPath.length>2048) throw Error('CLI path must be absolute');
    for (const m of p.models) {
      if (!m || typeof m.id!=='string' || !m.id.startsWith(p.id+'/') || !/^[a-zA-Z0-9_.:/-]{1,220}$/.test(m.id) || models.has(m.id) || typeof m.upstreamModel!=='string' || !/^[a-zA-Z0-9_.:/-]{1,180}$/.test(m.upstreamModel) || typeof m.name!=='string' || !m.name.trim() || m.name.length>180 || typeof m.enabled!=='boolean' || Object.keys(m).some(k=>!['id','upstreamModel','name','enabled'].includes(k))) throw Error('Invalid or duplicate model');
      models.add(m.id);
    }
  }
  if (typeof value.selectedModel!=='string' || !models.has(value.selectedModel) || !catalog(value).some(m=>m.id===value.selectedModel && m.enabled)) throw Error('Select an enabled model');
  if (Object.keys(value).some(k=>!['version','providers','selectedModel'].includes(k))) throw Error('Unknown configuration field');
  return value;
}
export function loadConfig(path) {
  if (!path) return defaultConfig();
  try {
    const value=validateConfig(JSON.parse(readFileSync(path,'utf8')));
    const shipped=value.providers.find(p=>p.id==='chatgpt')?.models.find(m=>m.id==='chatgpt/default');
    if(shipped?.name==='Codex · standaardmodel') shipped.name='Codex · default model';
    return value;
  }
  catch(e) { if(e.code==='ENOENT') return defaultConfig(); throw e; }
}
export function saveConfig(path, value) {
  validateConfig(value);
  if (!path) return;
  mkdirSync(dirname(path),{recursive:true});
  const temp=path+'.tmp';
  writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  renameSync(temp,path);
}
export function resolveConfiguredModel(config, requested) {
  const all=catalog(config);
  const aliases={'claude-subscription':'claude','chatgpt-subscription':'chatgpt','gemini-subscription':'google','commandcode-goat':'commandcode'};
  const id=requested==='subscription' ? config.selectedModel : legacySelections[requested] || requested;
  if (aliases[id]) {
    const selected=all.find(m=>m.id===config.selectedModel && m.providerID===aliases[id] && m.enabled);
    return selected || all.find(m=>m.providerID===aliases[id] && m.enabled);
  }
  return all.find(m=>m.id===id && m.enabled);
}
