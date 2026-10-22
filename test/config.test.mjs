import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig, loadConfig, saveConfig, validateConfig } from '../src/config.mjs';
import http from 'node:http';
import { createBridge } from '../src/server.mjs';

test('configuration persists without credentials and rejects unsafe or duplicate records', t=>{
  const dir=mkdtempSync(join(tmpdir(),'openbridge-config-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'config.json'),config=defaultConfig();
  config.providers[0].models[2].enabled=false;saveConfig(path,config);
  assert.deepEqual(loadConfig(path),config);
  assert.equal(readFileSync(path,'utf8').includes('API_KEY'),false);
  const duplicate=structuredClone(config);duplicate.providers[0].models.push(duplicate.providers[0].models[0]);assert.throws(()=>validateConfig(duplicate),/duplicate/);
  const secret=structuredClone(config);secret.providers[3].apiKey='no';assert.throws(()=>validateConfig(secret),/credentials/);
  const unsafe=structuredClone(config);unsafe.providers[3].baseURL='http://example.com/v1';assert.throws(()=>validateConfig(unsafe),/HTTPS/);
  unsafe.providers[3].baseURL='https://name:password@example.com/v1';assert.throws(()=>validateConfig(unsafe),/credentials/);
});

test('disabled models and providers disappear from catalog and direct requests are refused', async t=>{
  let calls=0;
  const server=createBridge({key:'test',runner:async()=>{calls++;return 'answer';}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer test'};
  const config=defaultConfig();config.selectedModel='claude/opus';config.providers[0].models[0].enabled=false;config.providers[1].enabled=false;
  assert.equal((await fetch(base+'/bridge/config',{method:'PUT',headers,body:JSON.stringify(config)})).status,200);
  const catalog=await (await fetch(base+'/v1/models',{headers})).json();
  assert.equal(catalog.data.some(m=>m.id==='claude/sonnet'||m.id==='chatgpt/default'),false);
  for(const model of ['claude/sonnet','chatgpt/default']) assert.equal((await fetch(base+'/v1/chat/completions',{method:'POST',headers,body:JSON.stringify({model,messages:[{role:'user',content:'hello'}]})})).status,400);
  assert.equal(calls,0);
});

test('custom provider config survives restart and catalog IDs identify the actual route', async t=>{
  const dir=mkdtempSync(join(tmpdir(),'openbridge-config-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'config.json');let received;
  const upstream=http.createServer(async(req,res)=>{let raw='';for await(const bytes of req)raw+=bytes;received={url:req.url,body:JSON.parse(raw)};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'upstream',choices:[{index:0,message:{role:'assistant',content:'hi'},finish_reason:'stop'}]}));});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>upstream.close());
  const config=defaultConfig();config.providers.push({id:'local',name:'Local fixture',type:'openai',enabled:true,cliPath:'',baseURL:`http://127.0.0.1:${upstream.address().port}/v1`,models:[{id:'local/example',name:'Example',upstreamModel:'example',enabled:true}]});
  saveConfig(path,config);
  const server=createBridge({key:'test',configPath:path});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`,{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({model:'local/example',messages:[{role:'user',content:'hello'}]})});
  const body=await response.json();assert.equal(body.model,'local/example');assert.equal(received.body.model,'example');assert.equal(received.url,'/v1/chat/completions');
});

test('inference clients cannot change providers or read management state',async t=>{
  const server=createBridge({key:'client-key',adminKey:'admin-key',runner:async()=> 'hello'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const client={Authorization:'Bearer client-key'},admin={Authorization:'Bearer admin-key'};
  assert.equal((await fetch(base+'/v1/models',{headers:client})).status,200);
  assert.equal((await fetch(base+'/bridge/status',{headers:client})).status,401);
  assert.equal((await fetch(base+'/bridge/config',{method:'PUT',headers:client,body:JSON.stringify(defaultConfig())})).status,401);
  assert.equal((await fetch(base+'/bridge/status',{headers:admin})).status,200);
  assert.equal((await fetch(base+'/v1/models',{headers:admin})).status,401);
});

test('oversized requests return HTTP 413 without resetting the connection',async t=>{
  const server=createBridge({key:'test',runner:async()=> 'hello'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`,{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({model:'claude/sonnet',messages:[{role:'user',content:'x'.repeat(300000)}]})});
  assert.equal(response.status,413);
});
