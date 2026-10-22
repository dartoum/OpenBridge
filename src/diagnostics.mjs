import { accessSync, constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
export function executable(path) { try { accessSync(path,constants.X_OK); return true; } catch { return false; } }
export async function diagnostics(config, secrets) {
  return Promise.all(config.providers.map(async p=>{
    const result={providerID:p.id,checkedAt:new Date().toISOString(),installed:p.type==='openai'||executable(p.cliPath),path:p.cliPath,version:'',auth:'Niet gecontroleerd',detail:''};
    if(!result.installed) {result.detail='CLI ontbreekt of is niet uitvoerbaar';return result;}
    if(p.type==='openai') {result.auth=secrets[p.id]?'API-sleutel ingesteld':p.id==='commandcode'?'API-sleutel ontbreekt':'Geen API-sleutel (mogelijk niet nodig)';result.detail='Een testaanvraag bevestigt toegang en modelbeschikbaarheid';return result;}
    try {
      if(p.type!=='antigravity') result.version=(await execute(p.cliPath,['--version'],{timeout:5000,maxBuffer:16384})).stdout.trim().slice(0,100);
      if(p.type==='claude') { const info=JSON.parse((await execute(p.cliPath,['auth','status'],{timeout:7000,maxBuffer:16384})).stdout); result.auth=info.loggedIn && info.authMethod==='claude.ai'?'Abonnementslogin bevestigd':info.loggedIn?'Andere login; controleer abonnement':'Niet aangemeld'; }
      if(p.type==='codex') {const info=await execute(p.cliPath,['login','status'],{timeout:7000,maxBuffer:16384});result.auth=/ChatGPT/i.test(info.stdout+info.stderr)?'ChatGPT-login bevestigd':'Geen bevestigde ChatGPT-login';}
      if(p.type==='antigravity') result.detail='Antigravity CLI gevonden; modellen ophalen en testaanvraag bevestigen de verbinding';
    } catch { result.detail='CLI-controle mislukt; meld opnieuw aan of controleer het pad'; }
    return result;
  }));
}
export async function discoverModels(provider, key, signal) {
  if(provider.type==='antigravity') {
    const result=await execute(provider.cliPath,['models'],{timeout:15000,maxBuffer:256*1024,signal});
    return result.stdout.split('\n').filter(line=>line.includes('\t')).map(line=>{const [id,...name]=line.split('\t');return {id, name:name.join(' ').trim()||id};}).filter(m=>/^[a-zA-Z0-9_.:/-]{1,180}$/.test(m.id));
  }
  if(provider.type==='openai') {
    const response=await fetch(provider.baseURL+'/models',{headers:key?{Authorization:`Bearer ${key}`}:{},signal,redirect:'error'});
    if(!response.ok) {await response.body?.cancel();throw Error(`Modellen ophalen mislukt (HTTP ${response.status})`);}
    const text=await response.text(); if(text.length>2*1024*1024) throw Error('Model response too large');
    const result=JSON.parse(text);
    return (result.data||[]).filter(m=>typeof m.id==='string'&&/^[a-zA-Z0-9_.:/-]{1,180}$/.test(m.id)).slice(0,300).map(m=>({id:m.id,name:m.name||m.id}));
  }
  throw Error('Deze CLI heeft geen ondersteunde modellenlijst. Voeg model-ID’s handmatig toe.');
}
