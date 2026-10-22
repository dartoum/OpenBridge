import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {defaultConfig, resolveConfiguredModel} from '../src/config.mjs';
import { parseCodex, parseAntigravity, codexArgs, runEvents, cleanEnvironment } from '../src/providers.mjs';

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
test('Antigravity fails closed when the CLI exposes tools or reports a failure', () => {
  assert.ok(parseAntigravity({event:'init',init:{tools:['run_command']}}).error);
  assert.equal(parseAntigravity({event:'init',init:{tools:[]}}).error,undefined);
  assert.equal(parseAntigravity({event:'step_update',step_update:{step_type:'agent_response',text_delta:'hello'}}).text,'hello');
  assert.equal(parseAntigravity({event:'result',result:{status:'SUCCESS',response:'hello'}}).done,true);
  assert.ok(parseAntigravity({event:'result',result:{status:'ERROR',error:'quota'}}).error);
});
test('CLI adapter preserves the original isolation failure over shutdown events', async t => {
  const dir=mkdtempSync(join(tmpdir(),'openbridge-events-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'fixture.mjs');
  writeFileSync(file, `process.on('SIGTERM',()=>{console.log(JSON.stringify({event:'result',result:{status:'INTERRUPTED',error:'interrupted'}}));process.exit(0);});console.log(JSON.stringify({event:'init',init:{tools:['run_command']}}));setInterval(()=>{},1000);`);
  await assert.rejects(runEvents({binary:process.execPath,args:[file],messages:[],signal:AbortSignal.timeout(5000),emit:()=>{},parse:parseAntigravity,ignoreStdin:true}),/exposed tools/);
});
