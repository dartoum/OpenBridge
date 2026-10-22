import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const execute=promisify(execFile);
export function discoveryEnvironment() {
 const env={...process.env};
 for(const k of Object.keys(env))if(/^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDECODE$|OPENAI_|CODEX_API_KEY$|CODEX_ACCESS_TOKEN$|COMMAND_CODE_API_KEY$|BRIDGE_API_KEY$)/.test(k))delete env[k];
 return env;
}
export function claudeCatalogue(binary,signal) {
 return new Promise((resolve,reject)=>{
  const cwd=mkdtempSync(join(tmpdir(),'openbridge-models-'));
  const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--safe-mode','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--no-session-persistence'];
  const child=spawn(binary,args,{cwd,env:discoveryEnvironment(),stdio:['pipe','pipe','pipe']});
  let buffer='',models,failure;
  const stop=()=>child.kill('SIGTERM');
  const timer=setTimeout(()=>{failure=Error('Claude model discovery timed out');stop();},18000);
  signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  child.stdout.setEncoding('utf8');child.stderr.resume();child.stdin.on('error',()=>{});
  child.stdout.on('data',data=>{
   buffer+=data;if(buffer.length>2*1024*1024){failure=Error('Model catalogue too large');stop();return;}
   let n;while((n=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,n);buffer=buffer.slice(n+1);
    try{const event=JSON.parse(line);if(event.type==='control_response'&&event.response?.request_id==='openbridge-models'){
     models=event.response?.response?.models;
     if(!Array.isArray(models))failure=Error('Claude CLI did not return a model catalogue');
     child.stdin.end();
    }}catch{failure=Error('Invalid Claude catalogue response');stop();}
   }
  });
  child.once('error',error=>{failure=error;});
  child.once('close',()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);rmSync(cwd,{recursive:true,force:true});if(signal?.aborted)reject(Error('Model discovery cancelled'));else if(failure||!models)reject(failure||Error('No Claude model catalogue returned'));else resolve(models);});
  child.stdin.write(JSON.stringify({type:'control_request',request_id:'openbridge-models',request:{subtype:'initialize'}})+'\n');
 });
}
export function claudeModelRows(models) {
 const rows=new Map();
 for(const m of models){
  if(typeof m.value!=='string')continue;
  const resolved=typeof m.resolvedModel==='string'?m.resolvedModel:m.value;
  // Keep existing aliases stable; also expose explicit version IDs.
  rows.set(m.value,{id:m.value,name:m.displayName||m.value,source:'Claude CLI',resolvedModel:resolved});
  if(resolved.startsWith('claude-')&&(m.value!=='default'||!rows.has(resolved)))rows.set(resolved,{id:resolved,name:m.value==='default'?resolved:m.displayName||resolved,source:'Claude CLI',resolvedModel:resolved});
 }
 return [...rows.values()].filter(m=>/^[a-zA-Z0-9_.:/-]{1,180}$/.test(m.id));
}
export async function discoverClaude(provider,signal,fetcher=fetch) {
 const native=claudeModelRows(await claudeCatalogue(provider.cliPath,signal));
 // Public metadata only: no account token, prompt or provider key is sent here.
 const response=await fetcher('https://models.dev/api.json',{signal,redirect:'error'});
 if(!response.ok)throw Error(`Public model catalogue HTTP ${response.status}; existing models were kept`);
 const parts=[];let size=0;for await(const part of response.body){size+=part.length;if(size>20*1024*1024)throw Error('Public catalogue too large');parts.push(part);}
 const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
 const rows=new Map(native.map(m=>[m.id,m]));
 for(const [id,m] of Object.entries(data.anthropic?.models||{}))if(/^claude-[a-zA-Z0-9_.-]{1,150}$/.test(id)&&!rows.has(id))rows.set(id,{id,name:m.name||id,source:'models.dev · public catalogue',resolvedModel:id});
 return [...rows.values()].slice(0,300);
}
export async function discoverCodex(provider,signal) {
 const cwd=mkdtempSync(join(tmpdir(),'openbridge-models-'));
 try{
  const {stdout}=await execute(provider.cliPath,['-c','forced_login_method="chatgpt"','-c','model_provider="openai"','debug','models'],{cwd,env:discoveryEnvironment(),signal,timeout:18000,maxBuffer:8*1024*1024});
  const value=JSON.parse(stdout);const models=Array.isArray(value)?value:value.models;
  if(!Array.isArray(models))throw Error('Codex returned no model catalogue');
  return models.filter(m=>typeof m.slug==='string'&&/^[a-zA-Z0-9_.:/-]{1,180}$/.test(m.slug)&&m.visibility!=='hide').slice(0,300).map(m=>({id:m.slug,name:m.display_name||m.slug,source:'Codex CLI catalogue',resolvedModel:m.slug}));
 }finally{rmSync(cwd,{recursive:true,force:true});}
}
