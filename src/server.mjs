import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runProvider, toolMode } from './providers.mjs';
import { loadConfig, validateConfig, saveConfig, catalog, availableModels, resolveConfiguredModel, EFFORT_PATTERN } from './config.mjs';
import { discoverModels } from './model-discovery.mjs';

const httpError = (status, message) => Object.assign(Error(message), { status });
const CLI_OPTIONS = ['model', 'messages', 'stream', 'tools', 'tool_choice', 'reasoning_effort'];
// Harmless length/sampling controls a CLI cannot take: dropped, and named in X-OpenBridge-Ignored on the response.
const IGNORED_ON_CLI = ['max_tokens', 'max_completion_tokens', 'temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop', 'seed', 'user', 'stream_options'];
const STREAM_LIMIT = 4 * 1024 * 1024;

export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Expected a JSON object');
  if (typeof body.model !== 'string' || body.model.length > 220) throw Error('Unsupported bridge model');
  if (body.stream !== undefined && typeof body.stream !== 'boolean') throw Error('stream must be boolean');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 200) throw Error('messages must contain 1–200 messages');
  for (const m of body.messages) {
    if (!m || !['system', 'developer', 'user', 'assistant', 'tool'].includes(m.role)) throw Error('Invalid message role');
    const textParts = Array.isArray(m.content) && m.content.every(p => p?.type === 'text' && typeof p.text === 'string');
    const toolCallOnly = m.role === 'assistant' && m.content == null && Array.isArray(m.tool_calls);
    if (typeof m.content !== 'string' && !toolCallOnly && !textParts) throw Error('Message content must be text or an array of text parts');
    if (m.role === 'tool' && typeof m.tool_call_id !== 'string') throw Error('Tool results require tool_call_id');
  }
  for (const name of ['max_tokens', 'max_completion_tokens']) if (body[name] !== undefined && (!Number.isInteger(body[name]) || body[name] < 1)) throw Error(`${name} must be a positive integer`);
  if (body.tools !== undefined && !Array.isArray(body.tools)) throw Error('tools must be an array');
  if (body.reasoning_effort !== undefined && (typeof body.reasoning_effort !== 'string' || !EFFORT_PATTERN.test(body.reasoning_effort))) throw Error('Invalid reasoning_effort');
  if (body.response_format !== undefined) {
    const format = body.response_format;
    if (!format || !['text', 'json_object', 'json_schema'].includes(format.type)) throw Error('Invalid response_format type');
    const schema = format.json_schema?.schema;
    if (format.type === 'json_schema' && (!schema || typeof schema !== 'object' || Array.isArray(schema))) throw Error('response_format.json_schema.schema must be a JSON Schema object');
  }
  return body;
}

// CLI adapters are text-only. Length/sampling controls are ignored (and reported); anything that would change
// the result, such as function calling, is refused rather than dropped. Returns the ignored option names.
function checkCliOptions(provider, body) {
  const allowed = new Set([...CLI_OPTIONS, ...IGNORED_ON_CLI]);
  const supportsStructured = provider.type === 'claude' || provider.type === 'antigravity';
  if (supportsStructured || body.response_format?.type === 'text') allowed.add('response_format');
  // Claude and Antigravity can emulate function calling (see toolMode); Codex cannot.
  const emulated = supportsStructured && body.tools?.length > 0;
  if (emulated) {
    allowed.add('parallel_tool_calls');
    if (!body.tools.every(tool => tool?.type === 'function' && /^[a-zA-Z0-9_-]{1,64}$/.test(tool.function?.name))) throw httpError(422, 'Only function tools with a simple name are supported');
    if (body.response_format && body.response_format.type !== 'text') throw httpError(422, 'response_format cannot be combined with tools on a CLI route');
  }
  const unsupported = Object.keys(body).filter(k => !allowed.has(k));
  const functions = !emulated && (body.tools?.length || (body.tool_choice && body.tool_choice !== 'none') || body.messages.some(m => m.role === 'tool' || m.tool_calls));
  if (unsupported.length || functions) throw httpError(422, `${provider.name} CLI does not support these options: ${unsupported.join(', ') || 'function calling'}. Use an OpenAI-compatible API provider for these features.`);
  return IGNORED_ON_CLI.filter(name => body[name] !== undefined);
}

// A request's reasoning_effort overrides the level configured for the model; both must be a level the CLI reported.
function cliEffort(spec, requested) {
  const effort = requested ?? spec.effort;
  if (effort === undefined || spec.efforts?.includes(effort)) return effort;
  throw httpError(422, spec.efforts?.length ? `${spec.id} supports reasoning_effort ${spec.efforts.join(', ')}` : `${spec.id} does not support reasoning_effort through this CLI adapter`);
}

async function readJSON(req, limit = 256 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn:false })) {
    bytes += chunk.length;
    if (bytes > limit) { req.resume(); throw httpError(413, 'Request too large'); }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJSON(res, status, value, headers = {}) {
  if (res.destroyed) return;
  res.writeHead(status, { 'Content-Type':'application/json', ...headers });
  res.end(JSON.stringify(value));
}
const sendError = (res, status, message) => sendJSON(res, status, { error:{ message, type:'bridge_error' } });

// Native Chat Completions forwarding: the upstream receives the client request with only the model ID replaced.
async function forwardChat({ provider, spec, body, apiKey, signal, res, event }) {
  const headers = { 'Content-Type':'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (provider.id === 'commandcode' && !apiKey) throw Error('Command Code API key is not configured');
  const upstream = await fetch(provider.baseURL.replace(/\/$/, '') + '/chat/completions', { method:'POST', headers, signal, redirect:'error', body:JSON.stringify({ ...body, model:spec.upstreamModel }) });
  if (!upstream.ok) throw Error(`Provider returned HTTP ${upstream.status}: ${(await upstream.text()).slice(0, 1500)}`);
  if (!body.stream) {
    const value = await upstream.json();
    value.model = spec.id;
    sendJSON(res, 200, value);
    return;
  }
  res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache' });
  const decoder = new TextDecoder();
  let buffer = '', done = false;
  const forward = line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') { done = true; res.write('data: [DONE]\n\n'); return; }
    if (!data) return;
    const value = JSON.parse(data);
    if (value.error) throw Error(value.error.message || 'Provider stream failed');
    value.model = spec.id;
    event(value);
  };
  for await (const bytes of upstream.body) {
    buffer += decoder.decode(bytes, { stream:true });
    if (buffer.length > STREAM_LIMIT) throw Error('Provider event too large');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) { forward(buffer.slice(0, end).replace(/\r$/, '')); buffer = buffer.slice(end + 1); }
  }
  buffer += decoder.decode();
  if (buffer.trim()) forward(buffer.trim());
  if (!done) throw Error('Provider stream ended before [DONE]');
  res.end();
}

export function createBridge({ key, adminKey = key, runner = runProvider, timeout = 120000, model, configPath, config:suppliedConfig } = {}) {
  if (!key || !adminKey) throw Error('Bridge and management keys required');
  let config = validateConfig(structuredClone(suppliedConfig || loadConfig(configPath)));
  if (model) config.selectedModel = resolveConfiguredModel(config, model)?.id || config.selectedModel;
  let maintenance = false, active = false, activeModel = null, currentController, checks = {};
  const secrets = {};
  if (process.env.COMMAND_CODE_API_KEY) secrets.commandcode = process.env.COMMAND_CODE_API_KEY;
  const stats = { startedAt:new Date().toISOString(), requests:0, succeeded:0, failed:0, lastDurationMs:null };
  const persist = next => { saveConfig(configPath, next); config = next; };

  const routes = {
    'GET /bridge/status': () => ({ service:'openbridge', version:7, model:config.selectedModel, selectedModelID:config.selectedModel, activeModel, active, maintenance, models:catalog(config), config, checks, runtime:{ version:process.version, path:process.execPath }, credentialProviders:Object.keys(secrets), ...stats }),
    'POST /bridge/maintenance': async req => {
      const body = await readJSON(req, 4096);
      if (typeof body.enabled !== 'boolean') throw httpError(400, 'enabled must be boolean');
      if (body.enabled && maintenance) throw httpError(409, 'CLI maintenance is already in progress');
      if (body.enabled && active) throw httpError(409, 'Wait for the active request before updating a CLI');
      maintenance = body.enabled;
      return { maintenance };
    },
    'PUT /bridge/config': async req => {
      const next = validateConfig(await readJSON(req));
      const changed = new Set(config.providers.filter(p => JSON.stringify(p) !== JSON.stringify(next.providers.find(n => n.id === p.id))).map(p => p.id));
      persist(next);
      checks = Object.fromEntries(Object.entries(checks).filter(([id]) => !changed.has(id.split('/')[0])));
      // A removed provider takes its key out of memory too.
      for (const id of Object.keys(secrets)) if (!next.providers.some(p => p.id === id)) delete secrets[id];
      return { saved:true };
    },
    'POST /bridge/discover': async req => {
      const body = await readJSON(req, 4096), provider = config.providers.find(p => p.id === body.providerID);
      if (!provider) throw httpError(400, 'Unknown provider');
      return discoverModels(provider, secrets[provider.id], AbortSignal.timeout(20000));
    },
    'POST /bridge/credentials': async req => {
      const body = await readJSON(req, 8192);
      if (!config.providers.some(p => p.id === body.providerID && p.type === 'openai') || typeof body.key !== 'string' || body.key.length > 4096) throw httpError(400, 'Invalid credential settings');
      if (body.key.trim()) secrets[body.providerID] = body.key.trim();
      else delete secrets[body.providerID];
      return { configured:Boolean(secrets[body.providerID]) };
    },
    'POST /bridge/model': async req => {
      const body = await readJSON(req, 4096), found = resolveConfiguredModel(config, body.model);
      if (!found) throw httpError(400, 'Model unknown or disabled');
      const next = structuredClone(config);
      next.selectedModel = found.id;
      persist(next);
      return { model:found.id, activeModel };
    },
    'POST /bridge/cancel': () => { currentController?.abort(); return { cancelled:active }; },
    'GET /v1/models': () => ({ object:'list', data:availableModels(config).filter(m => m.enabled).map(m => ({ id:m.id, object:'model', created:0, owned_by:m.providerID })) }),
  };

  async function chat(req, res) {
    const available = () => {
      if (maintenance) throw httpError(503, 'CLI maintenance in progress; retry when it finishes');
      if (active) throw httpError(429, 'Bridge busy; retry after the current request');
    };
    available();
    const body = validate(await readJSON(req));
    available();
    const selected = resolveConfiguredModel(config, body.model);
    if (!selected) throw httpError(400, 'Model unknown or disabled');
    // Snapshot provider and model so configuration changes only affect future requests.
    const provider = structuredClone(config.providers.find(p => p.id === selected.providerID));
    const spec = structuredClone(selected);
    let effort = body.reasoning_effort, tools = null;
    const extraHeaders = {};
    if (provider.type !== 'openai') {
      const ignored = checkCliOptions(provider, body);
      if (ignored.length) extraHeaders['X-OpenBridge-Ignored'] = ignored.join(',');
      effort = cliEffort(spec, body.reasoning_effort);
      if (provider.type === 'claude' || provider.type === 'antigravity') {
        try { tools = toolMode({ tools:body.tools, toolChoice:body.tool_choice, parallelToolCalls:body.parallel_tool_calls }); }
        catch (e) { throw httpError(422, e.message); }
        if (tools) extraHeaders['X-OpenBridge-Tools'] = 'emulated';
      }
      body.messages = body.messages.map(m => ({ role:m.role === 'developer' ? 'system' : m.role, content:Array.isArray(m.content) ? m.content.map(p => p.text).join('') : m.content,
        ...(m.tool_calls ? { tool_calls:m.tool_calls } : {}), ...(m.tool_call_id ? { tool_call_id:m.tool_call_id } : {}) }));
    }

    active = true; activeModel = spec.id; stats.requests++;
    const started = Date.now(), controller = new AbortController();
    currentController = controller;
    const timer = setTimeout(() => controller.abort(), timeout);
    res.on('close', () => controller.abort());
    const id = `chatcmpl-${randomUUID()}`, created = Math.floor(Date.now() / 1000);
    let streaming = false, text = '', resolvedModel;
    const event = value => {
      if (res.writableLength > STREAM_LIMIT) { controller.abort(); return; }
      if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`);
    };
    const chunk = (delta, finish_reason = null) => event({ id, object:'chat.completion.chunk', created, model:spec.id, choices:[{ index:0, delta, finish_reason }] });
    const record = success => ({ success, at:new Date().toISOString(), durationMs:Date.now() - started, ...(effort ? { effort } : {}), ...(resolvedModel ? { resolvedModel } : {}) });
    try {
      if (provider.type === 'openai') {
        streaming = Boolean(body.stream);
        await forwardChat({ provider, spec, body, apiKey:secrets[provider.id], signal:controller.signal, res, event });
      } else {
        const result = await runner(body.messages, controller.signal, delta => {
          text += delta;
          if (text.length > 2 * 1024 * 1024) { controller.abort(); return; }
          if (!body.stream || res.destroyed) return;
          if (!streaming) { res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', ...extraHeaders }); streaming = true; chunk({ role:'assistant' }); }
          chunk({ content:delta });
        }, spec.id, { provider, modelSpec:spec, options:body, effort, tools, onModel:value => { resolvedModel = value; } });
        if (result && typeof result === 'object') {
          // Emulated function calling: the answer is buffered, so tool calls arrive whole.
          const calls = result.tool_calls.map(call => ({ id:`call_${randomUUID().replaceAll('-', '').slice(0, 24)}`, type:'function', function:{ name:call.name, arguments:JSON.stringify(call.arguments) } }));
          const finish = calls.length ? 'tool_calls' : 'stop';
          if (body.stream) {
            res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', ...extraHeaders });
            chunk({ role:'assistant', ...(result.content ? { content:result.content } : {}) });
            if (calls.length) chunk({ tool_calls:calls.map((call, index) => ({ index, ...call })) });
            chunk({}, finish);
            res.end('data: [DONE]\n\n');
          } else sendJSON(res, 200, { id, object:'chat.completion', created, model:spec.id, choices:[{ index:0, message:{ role:'assistant', content:result.content ?? null, ...(calls.length ? { tool_calls:calls } : {}) }, finish_reason:finish }] }, extraHeaders);
        } else if (body.stream) {
          if (!streaming) { res.writeHead(200, { 'Content-Type':'text/event-stream', ...extraHeaders }); chunk({ role:'assistant', content:result }); }
          chunk({}, 'stop');
          res.end('data: [DONE]\n\n');
        } else sendJSON(res, 200, { id, object:'chat.completion', created, model:spec.id, choices:[{ index:0, message:{ role:'assistant', content:result }, finish_reason:'stop' }] }, extraHeaders);
      }
      stats.succeeded++;
      checks[spec.id] = record(true);
    } catch (e) {
      stats.failed++;
      checks[spec.id] = { ...record(false), message:e.message };
      if (streaming && res.headersSent) { event({ error:{ message:e.message, type:'bridge_error' } }); res.end(); }
      else sendError(res, controller.signal.aborted ? 504 : 502, e.message);
    } finally {
      clearTimeout(timer);
      active = false; activeModel = null; currentController = undefined;
      stats.lastDurationMs = Date.now() - started;
    }
  }

  const server = http.createServer(async (req, res) => {
    if (req.headers.origin) return sendError(res, 403, 'Browser origins are disabled; call from your application backend');
    const requiredKey = req.url?.startsWith('/bridge/') ? adminKey : key;
    const given = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${requiredKey}`);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return sendError(res, 401, 'Invalid bridge key');
    try {
      const route = routes[`${req.method} ${req.url}`];
      if (route) return sendJSON(res, 200, await route(req));
      if (req.method === 'POST' && req.url === '/v1/chat/completions') return await chat(req, res);
      sendError(res, 404, 'Not found');
    } catch (e) { sendError(res, e.status || 400, e.message); }
  });
  server.cancelActive = () => currentController?.abort();
  return server;
}

function readOrCreateKey(file) {
  try { return readFileSync(file, 'utf8').trim(); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const value = randomBytes(32).toString('hex');
    writeFileSync(file, value + '\n', { mode:0o600, flag:'wx' });
    return value;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.env.BRIDGE_API_KEY || readOrCreateKey('.bridge-key');
  const adminKey = readOrCreateKey('.bridge-admin-key');
  const server = createBridge({ key, adminKey, configPath:process.env.BRIDGE_CONFIG_PATH || join(process.cwd(), '.bridge-config.json') });
  server.listen(Number(process.env.PORT || 8000), '127.0.0.1', () => console.log('OpenBridge: http://127.0.0.1:' + server.address().port + '/v1 (key in .bridge-key or BRIDGE_API_KEY)'));
  const shutdown = () => {
    server.cancelActive();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, shutdown);
  // The app holds our stdin pipe open; when it quits or crashes the pipe closes and we must not outlive it.
  if (process.env.BRIDGE_EXIT_ON_STDIN_CLOSE === '1') { process.stdin.on('end', shutdown); process.stdin.on('error', shutdown); process.stdin.resume(); }
  // Exit rather than idle: the app's stdin pipe would keep a server that never listened alive, stuck on "Starting…".
  server.on('error', e => { console.error(e.message); process.exit(1); });
}
