import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridge } from '../src/server.mjs';
import { defaultConfig } from '../src/config.mjs';
import { runCodex, toolMode } from '../src/providers.mjs';

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
  assert.equal((await post({ ...body, tools: [] })).status, 200);
  assert.equal((await post({ ...body, messages: [{ role: 'user', content: [{type:'text',text:'hello'}] }] })).status, 200);
  assert.equal((await post({ ...body, messages: [{ role: 'user', content: 'fail' }] })).status, 502);
});

test('cancellation and concurrent request limit', async t => {
  let started;
  const ready = new Promise(r => { started = r; });
  const server = createBridge({ key: 'test', timeout: 150, queueTimeout: 0, runner: async (m, signal) => {
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
  let captured, upstreamAuth;
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const bytes of req) raw += bytes;
    upstreamAuth = req.headers.authorization;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model:JSON.parse(raw).model, choices:[{ index:0, message:{ role:'assistant', content:'ok' }, finish_reason:'stop' }] }));
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r)); t.after(()=>upstream.close());
  const config = defaultConfig(); config.providers[3].baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;
  const server = createBridge({ key:'test', model:'sonnet', config, runner: async (m,s,e,model,settings)=>{ captured={model,settings}; return model; } });
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={Authorization:'Bearer test'};
  const post=(path,value)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(value)});
  assert.equal((await post('/v1/chat/completions',{model:'commandcode/deepseek/deepseek-v4-flash',messages:[{role:'user',content:'hello'}]})).status,502);
  assert.equal((await post('/bridge/credentials',{providerID:'commandcode',key:'fixture-secret'})).status,200);
  const status=await (await fetch(base+'/bridge/status',{headers})).json();
  assert.equal(status.credentialProviders.includes('commandcode'),true);
  assert.equal(JSON.stringify(status).includes('fixture-secret'),false);
  assert.equal((await post('/bridge/model',{model:'commandcode'})).status,200);
  const answer=await (await post('/v1/chat/completions',{model:'subscription',messages:[{role:'user',content:'hello'}]})).json();
  assert.equal(answer.model,'commandcode/deepseek/deepseek-v4-flash');
  assert.equal(upstreamAuth,'Bearer fixture-secret');
  assert.equal(captured,undefined);
  await post('/v1/chat/completions',{model:'chatgpt-subscription',messages:[{role:'user',content:'hello'}]});
  assert.equal(captured.model,'chatgpt/default');
  assert.equal((await post('/bridge/credentials',{providerID:'unknown',key:'fixture-secret'})).status,400);
  assert.equal((await fetch(base+'/bridge/credentials',{method:'POST',body:'{}'})).status,401);
});

test('CLI maintenance requires admin access, blocks inference and cannot interrupt an active request', async t => {
 let complete;let started;const ready=new Promise(r=>started=r);
 const server=createBridge({key:'client',adminKey:'admin',runner:async()=>{started();return new Promise(r=>complete=r);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const headers=key=>({Authorization:'Bearer '+key,'Content-Type':'application/json'});
 const lock=(enabled,key='admin')=>fetch(base+'/bridge/maintenance',{method:'POST',headers:headers(key),body:JSON.stringify({enabled})});
 const post=()=>fetch(base+'/v1/chat/completions',{method:'POST',headers:headers('client'),body:JSON.stringify({model:'claude/haiku',messages:[{role:'user',content:'hello'}]})});
 assert.equal((await lock(true,'client')).status,401);
 assert.equal((await lock(true)).status,200);assert.equal((await lock(true)).status,409);assert.equal((await post()).status,503);
 assert.equal((await(await fetch(base+'/bridge/status',{headers:headers('admin')})).json()).maintenance,true);
 assert.equal((await lock(false)).status,200);
 const pending=post();await ready;assert.equal((await lock(true)).status,409);
 complete('ok');assert.equal((await pending).status,200);
 assert.equal((await lock(true)).status,200);assert.equal((await lock(false)).status,200);
});

test('the server process exits with the reason when its port is taken', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'openbridge-port-test-'));
  const blocker = net.createServer();
  t.after(() => { blocker.close(); rmSync(dir, { recursive:true, force:true }); });
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.mjs', import.meta.url))], { cwd:dir, stdio:['pipe', 'ignore', 'pipe'],
    env:{ ...process.env, PORT:String(blocker.address().port), BRIDGE_CONFIG_PATH:join(dir, 'config.json'), BRIDGE_EXIT_ON_STDIN_CLOSE:'1' } });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const code = await Promise.race([new Promise(resolve => child.once('close', resolve)), new Promise(resolve => setTimeout(() => resolve('still running'), 5000))]);
  child.kill('SIGKILL');
  assert.equal(code, 1);
  assert.match(stderr, /EADDRINUSE/);
});

test('Antigravity accepts json_schema it can validate and refuses keywords it cannot', async t => {
  const server = createBridge({ key: 'test', runner: async () => '{"a":1}' });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const post = response_format => fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ model: 'google/gemini-3.8-flash-medium', messages: [{ role: 'user', content: 'hi' }], response_format }) });
  assert.equal((await post({ type: 'json_schema', json_schema: { name: 'x', schema: { type: 'object', properties: { a: { type: 'integer' } } } } })).status, 200);
  const refused = await post({ type: 'json_schema', json_schema: { name: 'x', schema: { type: 'object', not: { type: 'null' } } } });
  assert.equal(refused.status, 422);
  assert.match((await refused.json()).error.message, /uses "not"/);
  assert.equal((await post({ type: 'json_object' })).status, 200);
});

test('a second request waits for its turn, and gets 429 with Retry-After only after the wait limit', async t => {
  const order = []; let release; const gate = new Promise(r => { release = r; });
  const server = createBridge({ key: 'test', queueTimeout: 400, runner: async messages => { order.push(messages[0].content); if (messages[0].content === 'first') await gate; return messages[0].content; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const post = content => fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ model: 'claude-subscription', messages: [{ role: 'user', content }] }) });
  const first = post('first');
  while (!order.length) await new Promise(r => setTimeout(r, 5));
  const second = post('second');
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(order, ['first']);
  release();
  assert.equal((await (await second).json()).choices[0].message.content, 'second');
  assert.equal((await first).status, 200);
  // Now hold the slot longer than the wait limit.
  const slow = createBridge({ key: 'test', queueTimeout: 100, timeout: 1000, runner: (m, signal) => new Promise((r, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })) });
  await new Promise(r => slow.listen(0, '127.0.0.1', r)); t.after(() => slow.close());
  const post2 = () => fetch(`http://127.0.0.1:${slow.address().port}/v1/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ model: 'claude-subscription', messages: [{ role: 'user', content: 'x' }] }) });
  post2().catch(() => {});
  await new Promise(r => setTimeout(r, 50));
  const refused = await post2();
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get('retry-after')) >= 1);
});

test('buffered streaming replies send SSE keepalive comments while the CLI works', async t => {
  const tool = { type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } };
  const server = createBridge({ key: 'test', keepAlive: 20, runner: async () => { await new Promise(r => setTimeout(r, 150)); return { content: null, tool_calls: [{ name: 'lookup', arguments: {} }] }; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ model: 'claude-subscription', stream: true, tools: [tool], messages: [{ role: 'user', content: 'x' }] }) });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-openbridge-tools'), 'mcp');
  assert.ok((text.match(/: keepalive/g) || []).length >= 2);
  assert.match(text, /"tool_calls"/);
  assert.match(text, /\[DONE\]/);
});

test('upstream statuses the client can act on pass through; others stay 502', async t => {
  const upstream = http.createServer();
  await new Promise(r => upstream.listen(0, '127.0.0.1', r)); t.after(() => upstream.close());
  const config = defaultConfig(); config.providers[3].baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;
  const server = createBridge({ key:'test', config });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`, headers = { Authorization:'Bearer test' };
  await fetch(base + '/bridge/credentials', { method:'POST', headers, body:JSON.stringify({ providerID:'commandcode', key:'k' }) });
  for (const [status, expected] of [[429, 429], [422, 422], [401, 502], [500, 502]]) {
    upstream.removeAllListeners('request');
    upstream.on('request', (req, res) => { res.writeHead(status, { 'Content-Type':'application/json', ...(status === 429 ? { 'Retry-After':'7' } : {}) }); res.end(JSON.stringify({ error:{ message:'fixture' } })); });
    const response = await fetch(base + '/v1/chat/completions', { method:'POST', headers, body:JSON.stringify({ model:'commandcode/deepseek/deepseek-v4-flash', messages:[{ role:'user', content:'x' }] }) });
    assert.equal(response.status, expected, `upstream ${status}`);
    assert.match((await response.json()).error.message, new RegExp('HTTP ' + status));
    if (status === 429) assert.equal(response.headers.get('retry-after'), '7');
  }
});

test('CLI token usage reaches the client in JSON, and in SSE only when include_usage is asked for', async t => {
  const usage = { prompt_tokens:10, completion_tokens:3, total_tokens:13 };
  const server = createBridge({ key:'test', runner: async (m, s, emit, id, { onUsage }) => { onUsage(usage); emit('hi'); return 'hi'; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const post = extra => fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, { method:'POST', headers:{ Authorization:'Bearer test' }, body:JSON.stringify({ model:'claude-subscription', messages:[{ role:'user', content:'x' }], ...extra }) });
  assert.deepEqual((await (await post({})).json()).usage, usage);
  const plain = await (await post({ stream:true })).text();
  assert.equal(plain.includes('total_tokens'), false);
  const asked = await post({ stream:true, stream_options:{ include_usage:true } });
  assert.equal(asked.headers.get('x-openbridge-ignored')?.includes('stream_options') ?? false, false);
  const chunks = (await asked.text()).split('\n').filter(l => l.startsWith('data: {')).map(l => JSON.parse(l.slice(6)));
  assert.deepEqual(chunks.at(-1).choices, []);
  assert.deepEqual(chunks.at(-1).usage, usage);
});

test('Codex accepts response_format and function calling', async t => {
  let seen;
  const server = createBridge({ key:'test', runner: async (m, s, emit, id, { tools }) => { seen = tools; return tools ? { content:null, tool_calls:[{ name:'f', arguments:{ a:1 } }] } : '{"a":1}'; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const post = extra => fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, { method:'POST', headers:{ Authorization:'Bearer test' }, body:JSON.stringify({ model:'chatgpt/default', messages:[{ role:'user', content:'x' }], ...extra }) });
  assert.equal((await post({ response_format:{ type:'json_object' } })).status, 200);
  assert.equal((await post({ response_format:{ type:'json_schema', json_schema:{ name:'x', schema:{ type:'object', additionalProperties:false, required:[], properties:{} } } } })).status, 200);
  assert.equal(seen, null);
  const tool = { type:'function', function:{ name:'f', parameters:{ type:'object', properties:{ a:{ type:'number' } } } } };
  const called = await post({ tools:[tool] });
  assert.equal(called.status, 200);
  assert.equal(called.headers.get('x-openbridge-tools'), 'mcp');
  assert.deepEqual(seen.names, ['f']);
  assert.equal((await called.json()).choices[0].finish_reason, 'tool_calls');
  assert.equal((await post({ tools:[tool], response_format:{ type:'json_object' } })).status, 422);
  assert.equal((await post({ messages:[{ role:'tool', tool_call_id:'c', content:'r' }] })).status, 422);
});

test('Codex offers the functions through its MCP config and collects the calls of one reply', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'openbridge-codex-'));
  t.after(() => rmSync(dir, { recursive:true, force:true }));
  const tools = toolMode({ tools:[{ type:'function', function:{ name:'rect', description:'Draw', parameters:{ type:'object' } } }] });
  const event = e => JSON.stringify(e);
  const call = (id, tool, args, server = 'c') => [event({ type:'item.started', item:{ id, type:'mcp_tool_call', server, tool, arguments:args, status:'in_progress' } }),
    event({ type:'item.completed', item:{ id, type:'mcp_tool_call', server, tool, arguments:args, status:'failed', error:{ message:'MCP tool call requires approval, but approval policy is never' } } })];
  // Fake CLI: records its arguments and stdin, prints the given events, then (like the real one) goes on working.
  const run = async (lines, extra = {}) => {
    const bin = join(dir, 'codex');
    writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n');
    writeFileSync(bin, `#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync('${dir}/args.json',JSON.stringify(process.argv.slice(2)));let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{fs.writeFileSync('${dir}/prompt.txt',s);process.stdout.write(fs.readFileSync('${dir}/events.jsonl','utf8'));setInterval(()=>{},1000);});\n`, { mode:0o755 });
    return runCodex([{ role:'user', content:'draw' }], AbortSignal.timeout(8000), () => {}, { binary:bin, tools, ...extra });
  };
  const started = Date.now();
  const ok = await run([event({ type:'item.completed', item:{ type:'agent_message', text:'Drawing two.' } }), ...call('i1', 'rect', { w:1 }), ...call('i2', 'rect', { w:2 }), ...call('i3', 'rect', { w:2 }),
    event({ type:'item.completed', item:{ type:'agent_message', text:'The tool failed.' } })]);
  assert.deepEqual(ok, { content:'Drawing two.', tool_calls:[{ name:'rect', arguments:{ w:1 } }, { name:'rect', arguments:{ w:2 } }] });
  assert.ok(Date.now() - started < 900, 'a following reply ends the collection at once');
  const args = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.match(args.find(a => a.startsWith('mcp_servers.c.args=')), /tool-mcp\.mjs/);
  const prompt = readFileSync(join(dir, 'prompt.txt'), 'utf8');
  assert.doesNotMatch(prompt, /Do not use tools/);
  assert.match(prompt, /Use your tools/);
  // No further event: the calls are returned after the settle time.
  assert.deepEqual(await run(call('i1', 'rect', { w:3 })), { content:null, tool_calls:[{ name:'rect', arguments:{ w:3 } }] });
  await assert.rejects(run(call('i1', 'shell', {})), /did not offer/);
  await assert.rejects(run(call('i1', 'rect', {}, 'other')), /outside the bridge/);
  await assert.rejects(run([event({ type:'item.completed', item:{ type:'command_execution' } })]), /unsupported tool action/);
});

test('Codex refuses a non-strict json_schema at once, with the reason', async t => {
  let ran = false;
  const server = createBridge({ key:'test', runner: async () => { ran = true; return '{"a":1}'; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const post = schema => fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, { method:'POST', headers:{ Authorization:'Bearer test' }, body:JSON.stringify({ model:'chatgpt/default', messages:[{ role:'user', content:'x' }], response_format:{ type:'json_schema', json_schema:{ name:'x', schema } } }) });
  const open = await post({ type:'object', required:['a'], properties:{ a:{ type:'string' } } });
  assert.equal(open.status, 422); assert.match((await open.json()).error.message, /additionalProperties: false/);
  const optional = await post({ type:'object', additionalProperties:false, required:['a'], properties:{ a:{ type:'string' }, b:{ type:'array', items:{ type:'object', additionalProperties:false, required:[], properties:{ c:{ type:'string' } } } } } });
  assert.equal(optional.status, 422); assert.match((await optional.json()).error.message, /missing: b/);
  assert.equal(ran, false);
  assert.equal((await post({ type:'object', additionalProperties:false, required:['a'], properties:{ a:{ type:'string' } } })).status, 200);
});

test('function calling on Antigravity needs the user-granted permission rule, which the bridge adds and removes alone', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'openbridge-agy-settings-'));
  const settings = join(dir, 'settings.json');
  process.env.AGY_SETTINGS_PATH = settings;
  t.after(() => { delete process.env.AGY_SETTINGS_PATH; rmSync(dir, { recursive:true, force:true }); });
  writeFileSync(settings, JSON.stringify({ model:'x', permissions:{ allow:['read_url(apple.com)'], deny:['mcp(*)'] }, trustedWorkspaces:['/a'] }));
  let ran = 0;
  const server = createBridge({ key:'test', runner: async () => { ran++; return { content:null, tool_calls:[{ name:'f', arguments:{} }] }; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`, headers = { Authorization:'Bearer test' };
  const status = async () => (await (await fetch(base + '/bridge/status', { headers })).json()).agyToolPermission;
  const grant = allowed => fetch(base + '/bridge/agy-tool-permission', { method:'POST', headers, body:JSON.stringify({ allowed }) });
  const call = () => fetch(base + '/v1/chat/completions', { method:'POST', headers, body:JSON.stringify({ model:'google/gemini-3.8-flash-medium', messages:[{ role:'user', content:'x' }], tools:[{ type:'function', function:{ name:'f', parameters:{ type:'object' } } }] }) });
  assert.deepEqual(await status(), { allowed:false });
  const refused = await call();
  assert.equal(refused.status, 422);
  assert.match((await refused.json()).error.message, /Let apps use tools with Gemini/);
  assert.equal(ran, 0);
  assert.deepEqual(await (await grant(true)).json(), { allowed:true });
  await grant(true);
  const after = JSON.parse(readFileSync(settings, 'utf8'));
  assert.deepEqual(after, { model:'x', permissions:{ allow:['read_url(apple.com)', 'mcp(openbridge_c/*)'], deny:['mcp(*)'] }, trustedWorkspaces:['/a'] });
  assert.equal((await call()).status, 200);
  assert.equal(ran, 1);
  assert.deepEqual(await (await grant(false)).json(), { allowed:false });
  assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')).permissions.allow, ['read_url(apple.com)']);
  // A settings file that does not parse is reported and never overwritten.
  writeFileSync(settings, '{ broken');
  assert.equal((await status()).allowed, null);
  const blocked = await grant(true);
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error.message, /could not be read/);
  assert.equal(readFileSync(settings, 'utf8'), '{ broken');
  // Plain chat on Antigravity is unaffected by the switch.
  assert.equal((await fetch(base + '/v1/chat/completions', { method:'POST', headers, body:JSON.stringify({ model:'google/gemini-3.8-flash-medium', messages:[{ role:'user', content:'x' }] }) })).status, 200);
});
