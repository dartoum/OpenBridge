import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeModel, sortModels } from '../src/model-families.mjs';
import { discoverClaude } from '../src/model-discovery.mjs';
import { defaultConfig, validateConfig, catalog } from '../src/config.mjs';
import { createBridge } from '../src/server.mjs';

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

test('Claude discovery keeps one row per version, records effort levels and skips the default alias', async t => {
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
  const publicModels = { 'claude-haiku-4-5':{ name:'Haiku 4.5 public' }, 'claude-haiku-4-5-latest':{}, 'claude-sonnet-4-5-20250929':{ name:'Sonnet dated' }, 'claude-sonnet-4-5':{ name:'Sonnet 4.5' }, 'claude-haiku-5-5':{ name:'Haiku 5.5' } };
  const rows = await discoverClaude({ cliPath:binary }, AbortSignal.timeout(5000), async () => new Response(JSON.stringify({ anthropic:{ models:publicModels } })));
  const ids = rows.map(r => r.id);
  assert.equal(ids.includes('default'), false);
  assert.deepEqual(ids.filter(id => id.includes('haiku')).sort(), ['claude-haiku-4-5-20251001', 'claude-haiku-5-5', 'haiku']);
  assert.deepEqual(ids.filter(id => id.includes('sonnet')), ['claude-sonnet-4-5']);
  assert.deepEqual(rows.find(r => r.id === 'claude-opus-5-5').efforts, ['low', 'medium', 'high', 'max']);
  assert.equal(rows.find(r => r.id === 'haiku').efforts, undefined);
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

test('CLI routes drop length and sampling options and say so, but still refuse function calling', async t => {
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
  const tools = await post({ tools:[{ type:'function', function:{ name:'x' } }] });
  assert.equal(tools.status, 422);
  assert.match((await tools.json()).error.message, /function calling/);
  assert.equal((await post({ n:2 })).status, 422);
});
