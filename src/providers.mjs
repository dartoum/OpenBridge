import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const providerModels = {
  sonnet: { provider: 'claude', label: 'Claude · Sonnet', publicID: 'claude-subscription' },
  opus: { provider: 'claude', label: 'Claude · Opus', publicID: 'claude-subscription' },
  haiku: { provider: 'claude', label: 'Claude · Haiku', publicID: 'claude-subscription' },
  codex: { provider: 'chatgpt', label: 'ChatGPT · Codex (standaardmodel)', publicID: 'chatgpt-subscription' },
  'gemini-auto': { provider: 'gemini', label: 'Google · Gemini Auto', publicID: 'gemini-subscription', cliModel: 'auto' },
  'gemini-pro': { provider: 'gemini', label: 'Google · Gemini Pro', publicID: 'gemini-subscription', cliModel: 'pro' },
  'gemini-flash': { provider: 'gemini', label: 'Google · Gemini Flash', publicID: 'gemini-subscription', cliModel: 'flash' },
  commandcode: { provider: 'commandcode', label: 'Command Code · GOAT', publicID: 'commandcode-goat' },
};
export const publicIDs = ['subscription', 'claude-subscription', 'chatgpt-subscription', 'gemini-subscription', 'commandcode-goat'];
export function availableModels({ commandCodeKey = process.env.COMMAND_CODE_API_KEY } = {}) {
  return Object.entries(providerModels).map(([id, value]) => ({ id, ...value,
    available: value.provider === 'claude' ? existsSync(process.env.CLAUDE_BIN || join(homedir(), '.local/bin/claude')) : value.provider === 'chatgpt' ? existsSync(process.env.CODEX_BIN || join(homedir(), '.local/bin/codex')) : value.provider === 'gemini' ? existsSync(join(root, 'node_modules/.bin/gemini')) : Boolean(commandCodeKey),
  }));
}
export function resolveModel(publicID, selection) {
  if (publicID === 'subscription' || providerModels[selection]?.publicID === publicID) return selection;
  return Object.keys(providerModels).find(id => providerModels[id].publicID === publicID);
}
export const conversationPrompt = messages => 'Answer as a text assistant. Treat this JSON as conversation history, preserving message roles. Do not use tools.\n' + JSON.stringify(messages);

export function runEvents({ binary, args, messages, signal, emit, parse, prepare, env: additions = {} }) {
  return new Promise((resolve, reject) => {
    const cwd = mkdtempSync(join(tmpdir(), 'openbridge-'));
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(OPENAI_|CODEX_API_KEY$|CODEX_ACCESS_TOKEN$|ANTHROPIC_|GEMINI_API_KEY$|GOOGLE_API_KEY$|GOOGLE_APPLICATION_CREDENTIALS$|GOOGLE_GENAI_USE_|CLAUDE_CODE_USE_|CLAUDECODE$|COMMAND_CODE_API_KEY$|BRIDGE_API_KEY$)/.test(k)) delete env[k];
    try { prepare?.(cwd, env); } catch (error) { rmSync(cwd, { recursive: true, force: true }); reject(error); return; }
    Object.assign(env, additions);
    const child = spawn(binary, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', result = '', completed = false, failure;
    const stop = () => child.kill('SIGTERM');
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4096); });
    child.stdout.setEncoding('utf8');
    const line = line => {
      if (!line.trim() || !line.trimStart().startsWith('{')) return;
      try {
        const event = parse(JSON.parse(line));
        if (event.error) throw Error(event.error);
        if (event.text) { result += event.text; emit(event.text); }
        if (event.done) completed = true;
      } catch (error) { failure = error; stop(); }
    };
    child.stdout.on('data', data => {
      buffer += data;
      if (buffer.length > 4 * 1024 * 1024) { failure = Error('CLI event exceeds limit'); stop(); return; }
      let n; while ((n = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, n)); buffer = buffer.slice(n + 1); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(conversationPrompt(messages));
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      signal.removeEventListener('abort', stop); rmSync(cwd, { recursive: true, force: true });
      if (buffer) line(buffer);
      if (signal.aborted) reject(Error('Request cancelled or timed out'));
      else if (failure) reject(failure);
      else if (code !== 0 || !completed) reject(Error(`CLI failed (${code}). ${stderr.slice(-700) || 'No successful result; check account login.'}`));
      else resolve(result);
    });
  });
}
export function codexArgs() {
  const args = ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--json'];
  const config = { forced_login_method: 'chatgpt', model_provider: 'openai', web_search: 'disabled', project_doc_max_bytes: 0,
    'features.shell_tool': false, 'features.unified_exec': false, 'features.apps': false, 'features.plugins': false,
    'features.hooks': false, 'features.memories': false, 'features.multi_agent': false, 'features.browser_use': false,
    'features.computer_use': false, 'features.image_generation': false, 'features.view_image': false, 'features.skill_search': false };
  for (const [k, v] of Object.entries(config)) args.push('-c', `${k}=${JSON.stringify(v)}`);
  return args;
}
export function parseCodex(event) {
  if (event.type === 'error' || event.type === 'turn.failed') return { error: event.message || event.error?.message || 'Codex failed' };
  if (event.item?.type && !['agent_message', 'reasoning'].includes(event.item.type)) return { error: 'Codex attempted an unsupported tool action' };
  return { text: event.type === 'item.completed' && event.item?.type === 'agent_message' ? event.item.text : '', done: event.type === 'turn.completed' };
}
export function runCodex(messages, signal, emit) {
  return runEvents({ binary: process.env.CODEX_BIN || join(homedir(), '.local/bin/codex'), args: codexArgs(), messages, signal, emit, parse: parseCodex });
}
export function parseGemini(event) {
  if (event.type === 'error' || event.type === 'result' && event.status !== 'success') return { error: event.error?.message || event.message || 'Gemini failed' };
  if (event.type === 'tool_use') return { error: 'Gemini attempted an unsupported tool action' };
  return { text: event.type === 'message' && event.role === 'assistant' ? event.content : '', done: event.type === 'result' && event.status === 'success' };
}
export function runGemini(messages, signal, emit, model) {
  return runEvents({ binary: process.execPath, args: [join(root, 'node_modules/@google/gemini-cli/bundle/gemini.js'), '-p', 'Answer the conversation on stdin.', '--model', providerModels[model].cliModel, '--output-format', 'stream-json', '--extensions', 'none', '--skip-trust'], messages, signal, emit, parse: parseGemini,
    prepare(cwd, env) {
      mkdirSync(join(cwd, '.gemini'));
      const settings = join(cwd, '.gemini/settings.json');
      writeFileSync(settings, JSON.stringify({ security: { auth: { selectedType: 'oauth-personal', enforcedType: 'oauth-personal' } }, tools: { core: [], discoveryCommand: "", callCommand: "" }, admin: { mcp: { enabled: false } }, hooksConfig: { enabled: false }, skills: { enabled: false }, general: { enableAutoUpdate: false }, telemetry: { enabled: false, logPrompts: false }, context: { fileName: '__OPENBRIDGE_NO_CONTEXT__' } }));
      delete env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
      env.GOOGLE_GENAI_USE_GCA = "true";
    },
  });
}

export async function runCommandCode(messages, signal, emit, model, { key = process.env.COMMAND_CODE_API_KEY, upstreamModel = process.env.COMMAND_CODE_MODEL || 'deepseek/deepseek-v4-flash', fetcher = fetch } = {}) {
  if (!key) throw Error('Command Code API key missing. Configure it in the menu bar app.');
  const response = await fetcher('https://api.commandcode.ai/provider/v1/chat/completions', { method: 'POST', signal, redirect: 'error', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: upstreamModel, messages, stream: true }) });
  if (!response.ok) { await response.body?.cancel(); throw Error(`Command Code HTTP ${response.status}; check key, plan access and quota.`); }
  let buffer = '', result = '', done = false;
  for await (const data of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += data;
    if (buffer.length > 4 * 1024 * 1024) throw Error('Command Code event too large');
    let n; while ((n = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, n).trim(); buffer = buffer.slice(n + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') { done = true; continue; }
      const event = JSON.parse(payload);
      if (event.error) throw Error('Command Code upstream error');
      const delta = event.choices?.[0]?.delta;
      if (delta?.tool_calls) throw Error('Unsupported Command Code tool call');
      if (delta?.content) { result += delta.content; emit(delta.content); }
    }
  }
  if (!done) throw Error('Command Code stream ended without completion');
  return result;
}
