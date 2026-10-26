import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {defaultConfig, resolveConfiguredModel} from '../src/config.mjs';
import { parseCodex, parseAntigravity, codexArgs, runEvents, cleanEnvironment, runAntigravity, runClaude, runCodex, toolMode, claudeUsage, codexUsage, antigravityUsage } from '../src/providers.mjs';

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
  assert.equal(parseAntigravity({event:'step_update',step_update:{step_type:'user_input'}}).error,undefined);
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
  writeFileSync(file,`#!/usr/bin/env node\nprocess.stdin.resume();console.log(JSON.stringify({event:'init',init:{model:'fixture-model'}}));console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',response:${JSON.stringify(response)}}}));\n`);
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

test('Claude receives a system prompt above the argument limit through a file', async t => {
  const dir=mkdtempSync(join(tmpdir(),'openbridge-claude-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'claude');
  writeFileSync(file,`#!/usr/bin/env node
import {readFileSync} from 'node:fs';
const args=process.argv.slice(2);
const inline=args.includes('--system-prompt');
const path=args[args.indexOf('--system-prompt-file')+1];
const size=path?readFileSync(path,'utf8').length:0;
const biggest=Math.max(...args.map(a=>Buffer.byteLength(a)));
console.log(JSON.stringify({type:'result',result:'inline='+inline+' size='+size+' biggestArg='+biggest}));
`.replace('#!/usr/bin/env node\nimport','#!/usr/bin/env node\nimport'));
  chmodSync(file,0o755);
  const system='x'.repeat(200*1024);
  const reply=await runClaude([{role:'system',content:system},{role:'user',content:'hi'}],signal(),()=>{},{binary:file});
  assert.match(reply,/inline=false size=204800/);
  assert.ok(Number(reply.match(/biggestArg=(\d+)/)[1])<96*1024);
});

test('Antigravity receives a prompt above the argument limit on stdin, not as an argument', async t => {
  const dir=mkdtempSync(join(tmpdir(),'openbridge-agy-stdin-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'agy');
  writeFileSync(file,`#!/usr/bin/env node
const args=process.argv.slice(2);let data='';
process.stdin.on('data',d=>{data+=d;if(!data.includes('\\n'))return;process.stdin.pause();
  const message=JSON.parse(data.trim());
  const biggest=Math.max(...args.map(a=>Buffer.byteLength(a)));
  console.log(JSON.stringify({event:'step_update',step_update:{step_type:'user_input'}}));
  console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'event='+message.event+' print='+args.includes('-p')+' biggestArg='+biggest+' promptBytes='+Buffer.byteLength(message.message.content)}}));
});
`);
  chmodSync(file,0o755);
  const reply=await runAntigravity([{role:'user',content:'y'.repeat(200*1024)}],signal(),()=>{},{binary:file});
  assert.match(reply,/event=user print=false/);
  assert.ok(Number(reply.match(/biggestArg=(\d+)/)[1])<96*1024);
  assert.ok(Number(reply.match(/promptBytes=(\d+)/)[1])>200*1024);
});

test('CLI usage is mapped as reported, without estimates', () => {
  // Shapes copied from real CLI result events. Claude's input_tokens excludes cache; Codex's includes it.
  assert.deepEqual(claudeUsage({input_tokens:2,cache_creation_input_tokens:2572,cache_read_input_tokens:649,output_tokens:4,output_tokens_details:{thinking_tokens:0}}),
    {prompt_tokens:3223,completion_tokens:4,total_tokens:3227,prompt_tokens_details:{cached_tokens:649},completion_tokens_details:{reasoning_tokens:0}});
  assert.deepEqual(codexUsage({input_tokens:15243,cached_input_tokens:12288,output_tokens:5,reasoning_output_tokens:0}),
    {prompt_tokens:15243,completion_tokens:5,total_tokens:15248,prompt_tokens_details:{cached_tokens:12288},completion_tokens_details:{reasoning_tokens:0}});
  assert.deepEqual(antigravityUsage({input_tokens:9977,output_tokens:24,thinking_tokens:23,cache_read_tokens:0,total_tokens:10001}),
    {prompt_tokens:9977,completion_tokens:24,total_tokens:10001,completion_tokens_details:{reasoning_tokens:23}});
  for (const map of [claudeUsage, codexUsage, antigravityUsage]) { assert.equal(map(undefined), undefined); assert.equal(map({input_tokens:'5'}), undefined); }
});

function fakeCodex(t, reply) {
  const dir=mkdtempSync(join(tmpdir(),'openbridge-codex-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'codex');
  writeFileSync(file,`#!/usr/bin/env node
import {readFileSync,existsSync} from 'node:fs';
const args=process.argv.slice(2);let prompt='';
process.stdin.on('data',d=>{prompt+=d;});
process.stdin.on('end',()=>{
  const schema=args.includes('--output-schema')&&existsSync('schema.json')?readFileSync('schema.json','utf8'):'none';
  const text=${JSON.stringify(reply)}==='$SEEN'?JSON.stringify({seen:'schema='+schema+' prompt='+prompt.includes('valid JSON object')}):${JSON.stringify(reply)};
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));
  console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:5,output_tokens:2}}));
});
`);
  chmodSync(file,0o755);
  return file;
}
test('Codex json_schema goes to --output-schema; json_object is asked for and validated', async t => {
  const schema={type:'object',additionalProperties:false,required:['a'],properties:{a:{type:'integer'}}};
  const emitted=[]; let usage;
  const out=await runCodex([{role:'user',content:'hi'}],signal(),d=>emitted.push(d),{binary:fakeCodex(t,'{"a":1}'),responseFormat:{type:'json_schema',json_schema:{name:'x',schema}},onUsage:u=>{usage=u;}});
  assert.equal(out,'{"a":1}');
  assert.deepEqual(emitted,['{"a":1}']);
  assert.equal(usage.total_tokens,7);
  // The fixture echoes what it saw instead of answering, to prove the schema file and the instruction arrived.
  const seen=await runCodex([{role:'user',content:'hi'}],signal(),()=>{},{binary:fakeCodex(t,'$SEEN'),responseFormat:{type:'json_schema',json_schema:{name:'x',schema}}});
  assert.equal(JSON.parse(seen).seen,'schema='+JSON.stringify(schema)+' prompt=false');
  assert.equal(JSON.parse(await runCodex([{role:'user',content:'hi'}],signal(),()=>{},{binary:fakeCodex(t,'$SEEN'),responseFormat:{type:'json_object'}})).seen,'schema=none prompt=true');
  await assert.rejects(runCodex([{role:'user',content:'hi'}],signal(),()=>{},{binary:fakeCodex(t,'[1]'),responseFormat:{type:'json_object'}}),/valid structured output/);
  assert.equal(await runCodex([{role:'user',content:'hi'}],signal(),()=>{},{binary:fakeCodex(t,'plain')}),'plain');
});

test('Codex turns a rejected schema into a readable 422', async t => {
  const dir=mkdtempSync(join(tmpdir(),'openbridge-codex-schema-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'codex');
  writeFileSync(file,`#!/usr/bin/env node
process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'turn.failed',error:{message:JSON.stringify({type:'error',error:{message:"Invalid schema: 'schema.additionalProperties' is required to be supplied and to be false when strict is true.",code:'invalid_json_schema'}})}}));});
`);
  chmodSync(file,0o755);
  await assert.rejects(runCodex([{role:'user',content:'hi'}],signal(),()=>{},{binary:file,responseFormat:{type:'json_schema',json_schema:{name:'x',schema:{type:'object'}}}}),error=>{
    assert.equal(error.status,422);
    assert.match(error.message,/strict JSON schemas.*additionalProperties/);
    return true;
  });
});
