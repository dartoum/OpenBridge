import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {defaultConfig, resolveConfiguredModel} from '../src/config.mjs';
import { parseCodex, parseAntigravity, runCommandCode, codexArgs, runEvents } from '../src/providers.mjs';

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
});
test('Antigravity fails closed when the CLI exposes tools or reports a failure', () => {
  assert.ok(parseAntigravity({event:'init',init:{tools:['run_command']}}).error);
  assert.equal(parseAntigravity({event:'init',init:{tools:[]}}).error,undefined);
  assert.equal(parseAntigravity({event:'step_update',step_update:{step_type:'agent_response',text_delta:'hello'}}).text,'hello');
  assert.equal(parseAntigravity({event:'result',result:{status:'SUCCESS',response:'hello'}}).done,true);
  assert.ok(parseAntigravity({event:'result',result:{status:'ERROR',error:'quota'}}).error);
});
test('Command Code forwards native roles, handles split SSE and refuses incomplete/errors', async () => {
  const messages = [{ role:'system', content:'system' }, { role:'user', content:'hello' }];
  let sent;
  const fetcher = async (url, options) => {
    sent = { url, options };
    return new Response(new ReadableStream({ start(controller) {
      for (const text of ['data: {"choices":[{"delta":{"con', 'tent":"hello"}}]}\n\ndata: [DONE]\n\n']) controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    } }));
  };
  const chunks = [];
  assert.equal(await runCommandCode(messages, new AbortController().signal, x=>chunks.push(x), 'commandcode', { key:'fixture-key', upstreamModel:'fixture-model', fetcher }), 'hello');
  assert.equal(sent.url, 'https://api.commandcode.ai/provider/v1/chat/completions');
  assert.deepEqual(JSON.parse(sent.options.body).messages, messages);
  assert.equal(JSON.parse(sent.options.body).model, 'fixture-model');
  assert.deepEqual(chunks, ['hello']);
  await assert.rejects(runCommandCode(messages, new AbortController().signal, ()=>{}, '', {key:'fixture',fetcher: async()=>new Response('',{status:429})}), /429/);
  await assert.rejects(runCommandCode(messages, new AbortController().signal, ()=>{}, '', {key:'fixture',fetcher: async()=>new Response('data: {"choices":[]}\n\n')}), /without completion/);
  await assert.rejects(runCommandCode(messages, new AbortController().signal, ()=>{}, '', {key:''}), /missing/);
});

test('CLI adapter preserves the original isolation failure over shutdown events', async t => {
  const dir=mkdtempSync(join(tmpdir(),'openbridge-events-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'fixture.mjs');
  writeFileSync(file, `process.on('SIGTERM',()=>{console.log(JSON.stringify({event:'result',result:{status:'INTERRUPTED',error:'interrupted'}}));process.exit(0);});console.log(JSON.stringify({event:'init',init:{tools:['run_command']}}));setInterval(()=>{},1000);`);
  await assert.rejects(runEvents({binary:process.execPath,args:[file],messages:[],signal:AbortSignal.timeout(5000),emit:()=>{},parse:parseAntigravity,ignoreStdin:true}),/exposed tools/);
});
