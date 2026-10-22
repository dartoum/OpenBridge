import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../src/server.mjs';

test('authenticated API, validation, streaming and upstream errors', async t => {
  const server = createBridge({ key: 'test', runner: async (messages, signal, emit) => {
    if (messages[0].content === 'fail') throw Error('upstream failure');
    emit('hello'); emit(' world'); return 'hello world';
  } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Bearer test', 'Content-Type': 'application/json' };
  const body = { model: 'claude-subscription', messages: [{ role: 'user', content: 'hello' }] };
  const post = value => fetch(base + '/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify(value) });
  assert.equal((await fetch(base + '/v1/models')).status, 401);
  assert.equal((await fetch(base + '/v1/models', { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  assert.equal((await (await fetch(base + '/v1/models', { headers })).json()).data[0].id, body.model);
  assert.equal((await (await post(body)).json()).choices[0].message.content, 'hello world');
  const stream = await (await post({ ...body, stream: true })).text();
  assert.match(stream, /hello/); assert.match(stream, / world/); assert.match(stream, /\[DONE\]/);
  const statusResponse = await fetch(base + '/bridge/status', { headers });
  const status = await statusResponse.json();
  assert.equal(status.service, 'openbridge');
  assert.equal(status.succeeded, 2);
  assert.equal(status.requests, 2);
  assert.equal(status.active, false);
  assert.equal((await post({ ...body, tools: [] })).status, 400);
  assert.equal((await post({ ...body, messages: [{ role: 'user', content: [] }] })).status, 400);
  assert.equal((await post({ ...body, messages: [{ role: 'user', content: 'fail' }] })).status, 502);
});

test('cancellation and concurrent request limit', async t => {
  let started;
  const ready = new Promise(r => { started = r; });
  const server = createBridge({ key: 'test', timeout: 150, runner: async (m, signal) => {
    started(); await new Promise((r, reject) => signal.addEventListener('abort', () => reject(Error('timeout')), { once: true }));
  } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const request = () => fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ model: 'claude-subscription', messages: [{ role: 'user', content: 'wait' }] }) });
  const first = request(); await ready;
  assert.equal((await request()).status, 429); assert.equal((await first).status, 504);
});

 test('management cancellation reaches active runner and updates statistics', async t => {
  let started;
  const ready = new Promise(r => { started = r; });
  const server = createBridge({ key: 'test', model: 'opus', runner: async (m, signal) => {
    started(); await new Promise((r, reject) => signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }));
  } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Bearer test' };
  const pending = fetch(base + '/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model: 'claude-subscription', messages: [{ role: 'user', content: 'wait' }] }) });
  await ready;
  assert.equal((await (await fetch(base + '/bridge/status', { headers })).json()).active, true);
  assert.equal((await fetch(base + '/bridge/cancel', { method: 'POST' })).status, 401);
  assert.equal((await (await fetch(base + '/bridge/cancel', { method: 'POST', headers })).json()).cancelled, true);
  assert.equal((await pending).status, 504);
  const status = await (await fetch(base + '/bridge/status', { headers })).json();
  assert.equal(status.failed, 1); assert.equal(status.model, 'opus'); assert.equal(status.active, false);
});
