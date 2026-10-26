import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {defaultConfig, resolveConfiguredModel} from '../src/config.mjs';
import { parseCodex, parseAntigravity, codexArgs, runEvents, cleanEnvironment, runAntigravity, toolMode } from '../src/providers.mjs';

test('concrete model IDs are fixed while subscription follows the menu', () => {
  const config=defaultConfig();config.selectedModel='chatgpt/default';
  assert.equal(resolveConfiguredModel(config,'subscription').id,'chatgpt/default');
  assert.equal(resolveConfiguredModel(config,'claude/opus').id,'claude/opus');
  assert.equal(resolveConfiguredModel(config,'claude-subscription').id,'claude/sonnet');
});
test('Codex event parsing does not leak reasoning and fails on tools and errors', () => {
  assert.equal(parseCodex({ type:'item.completed', item:{ type:'reasoning', text:'private' } }).text, '');
  assert.equal(parseCodex({ type:'item.completed', item:{ type:'agent_message', text:'answer' } }).text, 'answer');
  assert.equal(parseCodex({ type:'turn.completed' }).done, true);
  assert.ok(parseCodex({ type:'item.started', item:{ type:'command_execution' } }).error);
  assert.ok(parseCodex({ type:'turn.failed', error:{ message:'quota' } }).error);
  assert.ok(codexArgs().includes('forced_login_method="chatgpt"'));
  assert.ok(codexArgs().includes('features.shell_tool=false'));
  assert.equal(codexArgs().some(a=>a.startsWith('model_reasoning_effort')),false);
  const pinned=codexArgs({model:'gpt-6-sol',effort:'high'});
  assert.ok(pinned.includes('model_reasoning_effort="high"'));
  assert.deepEqual(pinned.slice(-2),['--model','gpt-6-sol']);
});
test('every CLI route strips API keys and provider switches from the environment', t => {
  const names=['ANTHROPIC_API_KEY','OPENAI_API_KEY','CODEX_ACCESS_TOKEN','GEMINI_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','COMMAND_CODE_API_KEY','CLAUDE_CODE_USE_BEDROCK'];
  for(const name of names){process.env[name]='fixture';t.after(()=>delete process.env[name]);}
  const env=cleanEnvironment();
  for(const name of names) assert.equal(env[name],undefined);
  assert.equal(env.PATH,process.env.PATH);
});
test('Antigravity fails closed when the CLI attempts a tool action or reports a failure', () => {
  assert.ok(parseAntigravity({event:'step_update',step_update:{step_type:'tool_call'}}).error);
  assert.ok(parseAntigravity({event:'step_update',step_update:{step_type:'command'}}).error);
  assert.ok(parseAntigravity({event:'step_update',step_update:{step_type:'file_write'}}).error);
  assert.ok(parseAntigravity({event:'step_update',step_update:{}}).error);
  assert.equal(parseAntigravity({event:'step_update',step_update:{step_type:'plan'}}).error,undefined);
  assert.equal(parseAntigravity({event:'step_update',step_update:{step_type:'agent_response',text_delta:'hello'}}).text,'hello');
  assert.equal(parseAntigravity({event:'result',result:{status:'SUCCESS',response:'hello'}}).done,true);
  assert.ok(parseAntigravity({event:'result',result:{status:'ERROR',error:'quota'}}).error);
});
test('CLI adapter preserves the original isolation failure over shutdown events', async t => {
  const dir=mkdtempSync(join(tmpdir(),'openbridge-events-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'fixture.mjs');
  writeFileSync(file, `process.on('SIGTERM',()=>{console.log(JSON.stringify({event:'result',result:{status:'INTERRUPTED',error:'interrupted'}}));process.exit(0);});console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool_call'}}));setInterval(()=>{},1000);`);
  await assert.rejects(runEvents({binary:process.execPath,args:[file],messages:[],signal:AbortSignal.timeout(5000),emit:()=>{},parse:parseAntigravity,ignoreStdin:true}),/attempted a tool action/);
});

function fakeAgy(t, response) {
  const dir=mkdtempSync(join(tmpdir(),'openbridge-agy-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'agy');
  writeFileSync(file,`#!/usr/bin/env node\nconsole.log(JSON.stringify({event:'init',init:{models:[{model:'fixture-model'}]}}));console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',response:${JSON.stringify(response)}}}));\n`);
  chmodSync(file,0o755);
  return file;
}
const signal=()=>AbortSignal.timeout(5000);
test('Antigravity emulates function calling and unwraps a fenced JSON reply', async t => {
  const tools=toolMode({tools:[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}]});
  let model;
  const result=await runAntigravity([{role:'user',content:'hi'}],signal(),()=>{},{binary:fakeAgy(t,'```json\n{"content":null,"tool_calls":[{"name":"lookup","arguments":{"q":"x"}}]}\n```'),tools,onModel:m=>{model=m;}});
  assert.deepEqual(result,{content:null,tool_calls:[{name:'lookup',arguments:{q:'x'}}]});
  assert.equal(model,'fixture-model');
});
test('Antigravity rejects tool calls to unknown functions and non-object structured output', async t => {
  const tools=toolMode({tools:[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}]});
  await assert.rejects(runAntigravity([{role:'user',content:'hi'}],signal(),()=>{},{binary:fakeAgy(t,'{"content":null,"tool_calls":[{"name":"other","arguments":{}}]}'),tools}),/valid function call/);
  await assert.rejects(runAntigravity([{role:'user',content:'hi'}],signal(),()=>{},{binary:fakeAgy(t,'[1]'),responseFormat:{type:'json_object'}}),/valid structured output/);
  const emitted=[];
  assert.equal(await runAntigravity([{role:'user',content:'hi'}],signal(),d=>emitted.push(d),{binary:fakeAgy(t,'{"a":1}'),responseFormat:{type:'json_object'}}),'{"a":1}');
  assert.deepEqual(emitted,['{"a":1}']);
});

test('a CLI that ignores SIGTERM is killed with its subprocesses, so the request settles', async t => {
  const dir=mkdtempSync(join(tmpdir(),'openbridge-kill-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const pidFile=join(dir,'child.pid'), file=join(dir,'fixture.mjs');
  writeFileSync(file,`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
process.on('SIGTERM',()=>{});
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`);
  const controller=new AbortController();
  const run=runEvents({binary:process.execPath,args:[file],messages:[],signal:controller.signal,emit:()=>{},parse:()=>({}),ignoreStdin:true});
  await new Promise(r=>setTimeout(r,500));
  controller.abort();
  await assert.rejects(run,/cancelled or timed out/);
  const pid=Number(readFileSync(pidFile,'utf8'));
  await new Promise(r=>setTimeout(r,200));
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
