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
  assert.equal((await (await fetch(base + '/v1/models', { headers })).json()).data[0].id, 'claude/sonnet');
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
  assert.equal(status.failed, 1); assert.equal(status.model, 'claude/opus'); assert.equal(status.active, false);
});

test('model changes apply to the next request while the active model remains fixed', async t => {
  let release, started;
  const ready = new Promise(r => { started = r; });
  const models = [];
  const server = createBridge({ key: 'test', model: 'sonnet', runner: async (m, signal, emit, model) => {
    models.push(model);
    if (models.length === 1) { started(); await new Promise(r => { release = r; }); }
    return model;
  } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Bearer test' };
  const post = (path, body) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const body = { model: 'claude-subscription', messages: [{ role: 'user', content: 'hello' }] };
  const first = post('/v1/chat/completions', body); await ready;
  assert.equal((await post('/bridge/model', { model: 'opus' })).status, 200);
  const status = await (await fetch(base + '/bridge/status', { headers })).json();
  assert.equal(status.model, 'claude/opus'); assert.equal(status.activeModel, 'claude/sonnet');
  assert.equal((await post('/bridge/model', { model: 'invalid' })).status, 400);
  assert.equal((await fetch(base + '/bridge/model', { method: 'POST', body: '{}' })).status, 401);
  release(); assert.equal((await (await first).json()).choices[0].message.content, 'claude/sonnet');
  assert.equal((await (await post('/v1/chat/completions', body)).json()).choices[0].message.content, 'claude/opus');
  assert.deepEqual(models, ['claude/sonnet', 'claude/opus']);
});

test('provider routing and Command Code settings require auth and never expose keys', async t => {
  let captured;
  const server = createBridge({ key:'test', model:'sonnet', runner: async (m,s,e,model,settings)=>{ captured={model,settings}; return model; } });
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={Authorization:'Bearer test'};
  const post=(path,value)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(value)});
  assert.equal((await post('/bridge/credentials',{providerID:'commandcode',key:'fixture-secret'})).status,200);
  const status=await (await fetch(base+'/bridge/status',{headers})).json();
  assert.equal(status.credentialProviders.includes('commandcode'),true);
  assert.equal(JSON.stringify(status).includes('fixture-secret'),false);
  assert.equal((await post('/bridge/model',{model:'commandcode'})).status,200);
  await post('/v1/chat/completions',{model:'subscription',messages:[{role:'user',content:'hello'}]});
  assert.equal(captured.model,'commandcode/deepseek/deepseek-v4-flash');
  assert.equal(captured.settings.commandCodeKey,'fixture-secret');
  await post('/v1/chat/completions',{model:'chatgpt-subscription',messages:[{role:'user',content:'hello'}]});
  assert.equal(captured.model,'chatgpt/default');
  assert.equal((await post('/bridge/credentials',{providerID:'unknown',key:'fixture-secret'})).status,400);
  assert.equal((await fetch(base+'/bridge/credentials',{method:'POST',body:'{}'})).status,401);
});
