import {discoverClaude,discoverCodex} from './model-discovery.mjs';
import { accessSync, constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
export function executable(path) { try { accessSync(path,constants.X_OK); return true; } catch { return false; } }
export async function diagnostics(config, secrets) {
  return Promise.all(config.providers.map(async p=>{
    const result={providerID:p.id,checkedAt:new Date().toISOString(),installed:p.type==='openai'||executable(p.cliPath),path:p.cliPath,version:'',auth:'Not checked',detail:''};
    if(!result.installed) {result.detail='CLI is missing or not executable';return result;}
    if(p.type==='openai') {result.auth=secrets[p.id]?'API key configured':p.id==='commandcode'?'API key missing':'No API key (may not be required)';result.detail='A test request confirms access and model availability';return result;}
    try {
      if(p.type!=='antigravity') result.version=(await execute(p.cliPath,['--version'],{timeout:5000,maxBuffer:16384})).stdout.trim().slice(0,100);
      if(p.type==='claude') { const info=JSON.parse((await execute(p.cliPath,['auth','status'],{timeout:7000,maxBuffer:16384})).stdout); result.auth=info.loggedIn && info.authMethod==='claude.ai'?'Subscription login confirmed':info.loggedIn?'Different login; check subscription':'Not signed in'; }
      if(p.type==='codex') {const info=await execute(p.cliPath,['login','status'],{timeout:7000,maxBuffer:16384});result.auth=/ChatGPT/i.test(info.stdout+info.stderr)?'ChatGPT login confirmed':'No confirmed ChatGPT login';}
      if(p.type==='antigravity') result.detail='Antigravity CLI found. Text-only isolation is currently blocked; model discovery does not confirm inference access.';
    } catch { result.detail='CLI check failed; sign in again or check the path'; }
    return result;
  }));
}
export async function discoverModels(provider, key, signal) {
  if(provider.type==='claude') return discoverClaude(provider,signal);
  if(provider.type==='codex') return discoverCodex(provider,signal);
  if(provider.type==='antigravity') {
    const result=await execute(provider.cliPath,['models'],{timeout:15000,maxBuffer:256*1024,signal});
    return result.stdout.split('\n').filter(line=>line.includes('\t')).map(line=>{const [id,...name]=line.split('\t');return {id, name:name.join(' ').trim()||id};}).filter(m=>/^[a-zA-Z0-9_.:/-]{1,180}$/.test(m.id));
  }
  if(provider.type==='openai') {
    const response=await fetch(provider.baseURL+'/models',{headers:key?{Authorization:`Bearer ${key}`}:{},signal,redirect:'error'});
    if(!response.ok) {await response.body?.cancel();throw Error(`Could not fetch models (HTTP ${response.status})`);}
    const text=await response.text(); if(text.length>2*1024*1024) throw Error('Model response too large');
    const result=JSON.parse(text);
    return (result.data||[]).filter(m=>typeof m.id==='string'&&/^[a-zA-Z0-9_.:/-]{1,180}$/.test(m.id)).slice(0,300).map(m=>({id:m.id,name:m.name||m.id}));
  }
  throw Error('This CLI has no supported model list. Add model IDs manually.');
}
