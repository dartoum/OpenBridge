import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodex, parseGemini, resolveModel, runCommandCode, codexArgs } from '../src/providers.mjs';

test('fixed provider IDs stay fixed while subscription follows the menu', () => {
  assert.equal(resolveModel('subscription', 'codex'), 'codex');
  assert.equal(resolveModel('claude-subscription', 'codex'), 'sonnet');
  assert.equal(resolveModel('claude-subscription', 'opus'), 'opus');
  assert.equal(resolveModel('chatgpt-subscription', 'sonnet'), 'codex');
  assert.equal(resolveModel('gemini-subscription', 'gemini-pro'), 'gemini-pro');
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
test('Gemini accepts only assistant messages and successful completion', () => {
  assert.equal(parseGemini({ type:'message', role:'user', content:'prompt' }).text, '');
  assert.equal(parseGemini({ type:'message', role:'assistant', content:'answer' }).text, 'answer');
  assert.equal(parseGemini({ type:'result', status:'success' }).done, true);
  assert.ok(parseGemini({ type:'result', status:'error' }).error);
  assert.ok(parseGemini({ type:'tool_use' }).error);
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
