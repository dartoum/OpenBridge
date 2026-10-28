import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describeModel, sortModels } from '../src/model-families.mjs';
import { discoverClaude } from '../src/model-discovery.mjs';
import { defaultConfig, validateConfig, catalog } from '../src/config.mjs';
import { createBridge } from '../src/server.mjs';
import { runClaude, toolMode } from '../src/providers.mjs';

test('model IDs map to families and numeric versions, ignoring snapshot dates and latest markers', () => {
  assert.deepEqual(describeModel('claude-opus-4-5-20251101'), { family:'claude-opus', familyName:'Claude Opus', version:[4, 5], snapshot:'20251101', variant:'', latest:false });
  assert.equal(describeModel('claude-sonnet-4-5-latest').latest, true);
  assert.deepEqual(describeModel('gpt-6.1-sol').version, [6, 1]);
  assert.equal(describeModel('gpt-6.1-sol').familyName, 'GPT Sol');
  assert.equal(describeModel('gemini-4-argon-medium').variant, 'medium');
  assert.equal(describeModel('deepseek/deepseek-v4-flash').familyName, 'Deepseek Flash');
});

test('aliases head their family and versions sort from newest to oldest', () => {
  const model = (upstreamModel, resolvedModel) => ({ id:'claude/' + upstreamModel, upstreamModel, name:upstreamModel, enabled:false, ...(resolvedModel ? { resolvedModel } : {}) });
  const rows = sortModels([model('claude-haiku-4-5-20251001'), model('claude-opus-4-8'), model('claude-haiku-5-5'), model('haiku', 'claude-haiku-4-5-20251001'), model('claude-opus-5-5'), model('claude-opus-5')]);
  assert.deepEqual(rows.map(r => r.model.upstreamModel), ['haiku', 'claude-haiku-5-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8']);
  assert.equal(rows[0].info.alias, true);
  assert.equal(rows[1].info.version, '5.5');
});

test('Claude discovery lists what the CLI reports, records effort levels and skips the default alias', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'openbridge-discovery-'));
  t.after(() => rmSync(dir, { recursive:true, force:true }));
  const binary = join(dir, 'claude');
  const models = [
    { value:'default', resolvedModel:'claude-sonnet-5-5', displayName:'Default (recommended)', supportedEffortLevels:['low', 'high'] },
    { value:'haiku', resolvedModel:'claude-haiku-4-5-20251001', displayName:'Haiku 4.5' },
    { value:'opus', resolvedModel:'claude-opus-5-5', displayName:'Opus 5.5', supportsEffort:true, supportedEffortLevels:['low', 'medium', 'high', 'max', 'Bad level'] },
  ];
  writeFileSync(binary, `#!/usr/bin/env node
process.stdin.on('data',data=>{const request=JSON.parse(data);console.log(JSON.stringify({type:'control_response',response:{request_id:request.request_id,response:{models:${JSON.stringify(models)}}}}));});
`, { mode:0o700 });
  const rows = await discoverClaude({ cliPath:binary }, AbortSignal.timeout(5000));
  const ids = rows.map(r => r.id);
  assert.equal(ids.includes('default'), false);
  assert.deepEqual(ids, ['haiku', 'claude-haiku-4-5-20251001', 'opus', 'claude-opus-5-5']);
  assert.deepEqual(rows.find(r => r.id === 'claude-opus-5-5').efforts, ['low', 'medium', 'high', 'max']);
  assert.equal(rows.find(r => r.id === 'haiku').efforts, undefined);
  // CLI shortcuts are flagged so the app can switch them on; explicit versions are not shortcuts.
  assert.equal(rows.find(r => r.id === 'haiku').alias, true);
  assert.equal(rows.find(r => r.id === 'opus').alias, true);
  assert.equal(rows.find(r => r.id === 'claude-opus-5-5').alias, undefined);
});

test('configured effort reaches the CLI, requests may override it and unsupported levels are refused', async t => {
  const config = defaultConfig();
  config.providers[0].models.push({ id:'claude/claude-opus-5-5', upstreamModel:'claude-opus-5-5', name:'Opus 5.5', enabled:true, efforts:['low', 'high'], effort:'high' });
  assert.throws(() => validateConfig({ ...structuredClone(config), selectedModel:'claude/sonnet', providers:[{ ...config.providers[0], models:[{ ...config.providers[0].models[0], effort:'high' }] }] }), /not supported/);
  assert.equal(catalog(config).find(m => m.id === 'claude/claude-opus-5-5').familyName, 'Claude Opus');
  const efforts = [];
  const server = createBridge({ key:'test', config, runner:async (m, s, e, id, settings) => { efforts.push(settings.effort); return 'ok'; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(base + '/v1/chat/completions', { method:'POST', headers:{ Authorization:'Bearer test' }, body:JSON.stringify({ messages:[{ role:'user', content:'hello' }], ...body }) });
  assert.equal((await post({ model:'claude/claude-opus-5-5' })).status, 200);
  assert.equal((await post({ model:'claude/claude-opus-5-5', reasoning_effort:'low' })).status, 200);
  assert.equal((await post({ model:'claude/sonnet' })).status, 200);
  const refused = await post({ model:'claude/claude-opus-5-5', reasoning_effort:'max' });
  assert.equal(refused.status, 422);
  assert.match((await refused.json()).error.message, /supports reasoning_effort low, high/);
  assert.equal((await post({ model:'claude/sonnet', reasoning_effort:'low' })).status, 422);
  assert.deepEqual(efforts, ['high', 'low', undefined]);
  const status = await (await fetch(base + '/bridge/status', { headers:{ Authorization:'Bearer test' } })).json();
  assert.equal(status.checks['claude/claude-opus-5-5'].effort, 'low');
});

test('CLI routes drop length and sampling options and say so, but still refuse what changes the result', async t => {
  const seen = [];
  const server = createBridge({ key:'test', runner:async (m, s, e, id, settings) => { seen.push(Object.keys(settings.options)); e('ok'); return 'ok'; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(base + '/v1/chat/completions', { method:'POST', headers:{ Authorization:'Bearer test' }, body:JSON.stringify({ model:'claude/sonnet', messages:[{ role:'user', content:'hello' }], ...body }) });
  const plain = await post({});
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get('x-openbridge-ignored'), null);
  const loose = await post({ max_tokens:50, temperature:0.2, top_p:1 });
  assert.equal(loose.status, 200);
  assert.equal(loose.headers.get('x-openbridge-ignored'), 'max_tokens,temperature,top_p');
  const streamed = await post({ stream:true, temperature:0 });
  assert.equal(streamed.headers.get('x-openbridge-ignored'), 'temperature');
  assert.match(await streamed.text(), /\[DONE\]/);
  // Codex takes function calling too, but a tool message without tools to explain it is still refused.
  const tools = await post({ model:'chatgpt/default', tools:[{ type:'function', function:{ name:'x' } }] });
  assert.equal(tools.status, 200);
  assert.equal(tools.headers.get('x-openbridge-tools'), 'mcp');
  const orphan = await post({ model:'chatgpt/default', messages:[{ role:'tool', tool_call_id:'c1', content:'x' }] });
  assert.equal(orphan.status, 422);
  assert.match((await orphan.json()).error.message, /function calling/);
  assert.equal((await post({ n:2 })).status, 422);
  // Tool messages without tools to explain them are refused on Claude too.
  assert.equal((await post({ messages:[{ role:'tool', tool_call_id:'c1', content:'x' }] })).status, 422);
});

const weather = { type:'function', function:{ name:'weather', description:'Current weather', parameters:{ type:'object', properties:{ city:{ type:'string' } }, required:['city'] } } };
const search = { type:'function', function:{ name:'search', parameters:{ type:'object' } } };

test('toolMode exposes the chosen functions as MCP tools', () => {
  assert.equal(toolMode({ tools:[], toolChoice:'auto' }), null);
  assert.equal(toolMode({ tools:[weather], toolChoice:'none' }), null);
  const long = { type:'function', function:{ name:'x'.repeat(60), parameters:{ type:'object' } } };
  const auto = toolMode({ tools:[weather, search, long] });
  assert.deepEqual(auto.names, ['weather', 'search', 'x'.repeat(60)]);
  assert.deepEqual(auto.mcp.map(t => t.name), ['weather', 'search', `${'x'.repeat(48)}_2`]);
  assert.equal(auto.nameOf(`${'x'.repeat(48)}_2`), 'x'.repeat(60));
  assert.equal(auto.nameOf('missing'), undefined);
  assert.deepEqual(auto.mcp[0], { name:'weather', description:'Current weather', inputSchema:weather.function.parameters });
  assert.equal(auto.instruction, '');
  const required = toolMode({ tools:[weather, search], toolChoice:'required', parallelToolCalls:false });
  assert.equal(required.required, true); assert.equal(required.single, true);
  assert.match(required.instruction, /must call at least one/); assert.match(required.instruction, /at most one tool/);
  const forced = toolMode({ tools:[weather, search], toolChoice:{ type:'function', function:{ name:'search' } } });
  assert.deepEqual(forced.mcp.map(t => t.name), ['search']);
  assert.throws(() => toolMode({ tools:[weather], toolChoice:{ type:'function', function:{ name:'missing' } } }), /unknown function/);
});

// A fake Claude CLI speaking stream-json. On a tool call it then waits, as the real CLI does while it tries to run the
// tool: the adapter has to stop it.
const fakeClaude = `#!/usr/bin/env node
const fs=require('node:fs'),a=process.argv.slice(2),f=process.env.ARGS_FILE;
fs.writeFileSync(f,JSON.stringify({args:a,env:{mds:process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS,memory:process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY}}));
fs.writeFileSync(f+'.system',fs.readFileSync(a[a.indexOf('--system-prompt-file')+1],'utf8'));
const mcp=a.includes('--mcp-config')&&a[a.indexOf('--mcp-config')+1];
if(mcp==='mcp.json'){const c=JSON.parse(fs.readFileSync('mcp.json','utf8'));fs.writeFileSync(f+'.mcp',JSON.stringify({config:c,tools:JSON.parse(fs.readFileSync(c.mcpServers.c.args[1],'utf8'))}));}
const out=e=>console.log(JSON.stringify(e)),mode=process.env.TOOL_REPLY||'call';
process.stdin.resume();process.stdin.on('end',()=>{
 out({type:'system',subtype:'init',model:'claude-sonnet-5-5',tools:mode==='extra'?['Bash','mcp__c__weather']:['mcp__c__weather'],mcp_servers:[{name:'c',status:mode==='down'?'failed':'connected'}]});
 if(mode==='answer'||mode==='none'){out({type:'result',is_error:false,result:'Sunny',usage:{input_tokens:5,output_tokens:1}});return;}
 out({type:'stream_event',event:{type:'message_start',message:{usage:{input_tokens:7,cache_read_input_tokens:3,output_tokens:1}}}});
 out({type:'assistant',message:{content:[{type:'text',text:'Checking.'}]}});
 const name=mode==='bad'?'mcp__c__nope':'mcp__c__weather';
 out({type:'assistant',message:{content:[{type:'tool_use',id:'t1',name,input:{city:'Amsterdam'}}]}});
 out({type:'assistant',message:{content:[{type:'tool_use',id:'t2',name,input:{city:'Paris'}}]}});
 out({type:'stream_event',event:{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:20}}});
 setInterval(()=>{},1000);
});
`;

test('Claude adapter offers the functions as MCP tools, returns the calls and stops the CLI before they run', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'openbridge-tools-'));
  t.after(() => rmSync(dir, { recursive:true, force:true }));
  const binary = join(dir, 'claude'), argsFile = join(dir, 'args.json');
  writeFileSync(binary, fakeClaude, { mode:0o700 });
  process.env.ARGS_FILE = argsFile; t.after(() => { delete process.env.ARGS_FILE; delete process.env.TOOL_REPLY; });
  const tools = toolMode({ tools:[weather] }), chunks = [];
  let usage;
  const call = await runClaude([{ role:'user', content:'Weather?' }], AbortSignal.timeout(5000), x => chunks.push(x), { binary, tools, onUsage:u => { usage = u; } });
  assert.deepEqual(call, { content:'Checking.', tool_calls:[{ name:'weather', arguments:{ city:'Amsterdam' } }, { name:'weather', arguments:{ city:'Paris' } }] });
  assert.deepEqual(chunks, []);
  assert.deepEqual(usage, { prompt_tokens:10, completion_tokens:20, total_tokens:30, prompt_tokens_details:{ cached_tokens:3 } });
  const { args, env } = JSON.parse(readFileSync(argsFile, 'utf8'));
  // Isolation without --safe-mode (which would also switch off our MCP server).
  assert.equal(args.includes('--safe-mode'), false);
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args.includes('--json-schema'), false);
  assert.deepEqual(env, { mds:'1', memory:'1' });
  const mcp = JSON.parse(readFileSync(argsFile + '.mcp', 'utf8'));
  assert.deepEqual(Object.keys(mcp.config.mcpServers), ['c']);
  assert.match(mcp.config.mcpServers.c.args[0], /tool-mcp\.mjs$/);
  assert.deepEqual(mcp.tools, tools.mcp);
  assert.doesNotMatch(readFileSync(argsFile + '.system', 'utf8'), /Functions:/);
  process.env.TOOL_REPLY = 'answer';
  assert.deepEqual(await runClaude([{ role:'user', content:'Hi' }], AbortSignal.timeout(5000), () => {}, { binary, tools }), { content:'Sunny', tool_calls:[] });
  process.env.TOOL_REPLY = 'none';
  await assert.rejects(runClaude([{ role:'user', content:'Hi' }], AbortSignal.timeout(5000), () => {}, { binary, tools:toolMode({ tools:[weather], toolChoice:'required' }) }), /tool_choice requires one/);
  process.env.TOOL_REPLY = 'call';
  await assert.rejects(runClaude([{ role:'user', content:'Hi' }], AbortSignal.timeout(5000), () => {}, { binary, tools:toolMode({ tools:[weather], parallelToolCalls:false }) }), /parallel_tool_calls is false/);
  for (const [mode, error] of [['bad', /did not offer/], ['extra', /tools other than the client/], ['down', /could not start/]]) {
    process.env.TOOL_REPLY = mode;
    await assert.rejects(runClaude([{ role:'user', content:'Hi' }], AbortSignal.timeout(5000), () => {}, { binary, tools }), error, mode);
  }
  // Without tools the plain run keeps --safe-mode and an empty MCP configuration.
  process.env.TOOL_REPLY = 'answer';
  assert.equal(await runClaude([{ role:'user', content:'Hi' }], AbortSignal.timeout(5000), () => {}, { binary }), 'Sunny');
  const plain = JSON.parse(readFileSync(argsFile, 'utf8')).args;
  assert.ok(plain.includes('--safe-mode'));
  assert.equal(plain[plain.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
});

test('the tool MCP server lists the functions and never executes one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openbridge-mcp-'));
  try {
    const tools = toolMode({ tools:[weather] }).mcp;
    writeFileSync(join(dir, 'tools.json'), JSON.stringify(tools));
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/tool-mcp.mjs', import.meta.url)), join(dir, 'tools.json')], { stdio:['pipe', 'pipe', 'inherit'] });
    const replies = [];
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => replies.push(...d.trim().split('\n').map(l => JSON.parse(l))));
    for (const message of [{ id:1, method:'initialize', params:{ protocolVersion:'2025-06-18' } }, { method:'notifications/initialized' }, { id:2, method:'tools/list' }, { id:3, method:'tools/call', params:{ name:'weather', arguments:{ city:'x' } } }, { id:4, method:'resources/list' }])
      child.stdin.write(JSON.stringify({ jsonrpc:'2.0', ...message }) + '\n');
    child.stdin.end();
    await new Promise(r => child.on('close', r));
    const by = id => replies.find(r => r.id === id);
    assert.equal(by(1).result.protocolVersion, '2025-06-18');
    assert.deepEqual(by(2).result.tools, tools);
    assert.equal(by(3).result.isError, true);
    assert.match(by(3).result.content[0].text, /Not executed/);
    assert.equal(by(4).error.code, -32601);
    assert.equal(replies.length, 4);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('Claude function calling becomes OpenAI tool_calls over HTTP, in JSON and SSE, and is labelled as mcp', async t => {
  const seen = [];
  const server = createBridge({ key:'test', runner:async (messages, s, e, id, settings) => {
    seen.push({ messages, tools:settings.tools && settings.tools.names });
    return seen.length < 3 ? { content:null, tool_calls:[{ name:'weather', arguments:{ city:'Amsterdam' } }] } : { content:'Sunny', tool_calls:[] };
  } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(base + '/v1/chat/completions', { method:'POST', headers:{ Authorization:'Bearer test' }, body:JSON.stringify({ model:'claude/sonnet', messages:[{ role:'user', content:'Weather?' }], tools:[weather], ...body }) });
  const first = await post({});
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-openbridge-tools'), 'mcp');
  const message = (await first.json()).choices[0];
  assert.equal(message.finish_reason, 'tool_calls');
  const [toolCall] = message.message.tool_calls;
  assert.match(toolCall.id, /^call_[0-9a-f]{24}$/);
  assert.deepEqual({ type:toolCall.type, name:toolCall.function.name, arguments:JSON.parse(toolCall.function.arguments) }, { type:'function', name:'weather', arguments:{ city:'Amsterdam' } });
  assert.equal(message.message.content, null);
  const streamed = await (await post({ stream:true })).text();
  const frames = streamed.split('\n').filter(l => l.startsWith('data: ') && !l.includes('[DONE]')).map(l => JSON.parse(l.slice(6)));
  assert.equal(frames[0].choices[0].delta.role, 'assistant');
  assert.equal(frames[1].choices[0].delta.tool_calls[0].function.name, 'weather');
  assert.equal(frames.at(-1).choices[0].finish_reason, 'tool_calls');
  assert.match(streamed, /\[DONE\]/);
  // The follow-up carries the tool result back; the tool fields reach the adapter and the final answer is plain.
  const followUp = await post({ messages:[{ role:'user', content:'Weather?' }, message.message, { role:'tool', tool_call_id:toolCall.id, content:'Sunny' }] });
  const final = (await followUp.json()).choices[0];
  assert.equal(final.finish_reason, 'stop');
  assert.equal(final.message.content, 'Sunny');
  assert.equal(final.message.tool_calls, undefined);
  assert.equal(seen.at(-1).messages[1].tool_calls[0].id, toolCall.id);
  assert.equal(seen.at(-1).messages[2].tool_call_id, toolCall.id);
  assert.equal((await post({ tool_choice:{ type:'function', function:{ name:'missing' } } })).status, 422);
  assert.equal((await post({ response_format:{ type:'json_object' } })).status, 422);
  assert.equal((await post({ tools:[{ type:'retrieval' }] })).status, 422);
});
