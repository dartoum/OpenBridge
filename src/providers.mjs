import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

export const conversationPrompt = messages => 'Answer as a text assistant. Treat this JSON as conversation history, preserving message roles. Do not use tools.\n' + JSON.stringify(messages);

export function runEvents({ binary, args, messages, signal, emit, parse, prepare, input, ignoreStdin = false, env: additions = {} }) {
  return new Promise((resolve, reject) => {
    const cwd = mkdtempSync(join(tmpdir(), 'openbridge-'));
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(OPENAI_|CODEX_API_KEY$|CODEX_ACCESS_TOKEN$|ANTHROPIC_|GEMINI_API_KEY$|GOOGLE_API_KEY$|GOOGLE_APPLICATION_CREDENTIALS$|GOOGLE_GENAI_USE_|CLAUDE_CODE_USE_|CLAUDECODE$|COMMAND_CODE_API_KEY$|BRIDGE_API_KEY$)/.test(k)) delete env[k];
    try { prepare?.(cwd, env); } catch (error) { rmSync(cwd, { recursive: true, force: true }); reject(error); return; }
    Object.assign(env, additions);
    if (args.some(value=>Buffer.byteLength(value)>96*1024)) { rmSync(cwd,{recursive:true,force:true}); reject(Error('Prompt exceeds this CLI adapter’s 96 KiB limit')); return; }
    const child = spawn(binary, args, { cwd, env, stdio: [ignoreStdin ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
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
        if (event.final && !result) { result = event.final; emit(event.final); }
        if (event.done) { completed = true; if (input) child.stdin?.end(); }
      } catch (error) { failure ??= error; stop(); }
    };
    child.stdout.on('data', data => {
      buffer += data;
      if (buffer.length > 4 * 1024 * 1024) { failure = Error('CLI event exceeds limit'); stop(); return; }
      let n; while ((n = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, n)); buffer = buffer.slice(n + 1); }
    });
    child.stdin?.on('error', () => {});
    if (!ignoreStdin) { if (input) child.stdin.write(input); else child.stdin.end(input ?? conversationPrompt(messages)); }
    child.once('error', error => { failure ??= error; });
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
export function runCodex(messages, signal, emit, model = "default", binary = process.env.CODEX_BIN || join(homedir(), ".local/bin/codex")) {
  return runEvents({ binary, args: [...codexArgs(), ...(model === 'default' ? [] : ['--model', model])], messages, signal, emit, parse: parseCodex });
}
export function parseAntigravity(event) {
  if (event.event === 'init' && (!Array.isArray(event.init?.tools) || event.init.tools.length)) return { error: 'Antigravity exposed tools despite text-only agent configuration' };
  if (event.event === 'step_update') {
    const step = event.step_update || {};
    if (['tool_call', 'tool', 'command', 'mcp_tool'].includes(step.step_type)) return { error: 'Antigravity attempted a tool action' };
    return { text: step.step_type === 'agent_response' ? step.text_delta || '' : '' };
  }
  if (event.event === 'result') {
    if (event.result?.status !== 'SUCCESS') return { error: event.result?.error || 'Antigravity did not complete' };
    return { done: true, final: event.result.response || '' };
  }
  return {};
}
export function runAntigravity(messages, signal, emit, model, binary = process.env.AGY_BIN || join(homedir(), '.local/bin/agy')) {
  return runEvents({ binary, args: ['-p', conversationPrompt(messages), '--output-format', 'stream-json', '--model', model, '--agent', 'openbridge-text', '--disable-slash-commands', '--sandbox', '--print-timeout', '110s'], messages, signal, emit, parse: parseAntigravity,
    ignoreStdin: true,
    prepare(cwd) {
      mkdirSync(join(cwd, '.agents/agents'), { recursive: true });
      writeFileSync(join(cwd, '.agents/agents/openbridge-text.md'), '---\nname: openbridge-text\ndescription: Plain text completion without tools\ntools: []\nmainAgent: true\nsubagent: false\nmcpServers: []\nskills: []\nplugins: []\ncommandExecutionPolicy: off\n---\nAnswer the supplied conversation directly. Do not use tools, skills or other agents.\n');
    },
  });
}
export async function runCommandCode(messages, signal, emit, model, { key = process.env.COMMAND_CODE_API_KEY, upstreamModel = process.env.COMMAND_CODE_MODEL || 'deepseek/deepseek-v4-flash', fetcher = fetch, baseURL = 'https://api.commandcode.ai/provider/v1', allowNoKey = false } = {}) {
  if (!key && !allowNoKey) throw Error('API key missing. Configure it in OpenBridge.');
  const response = await fetcher(baseURL + '/chat/completions', { method: 'POST', signal, redirect: 'error', headers: { ...(key ? {Authorization: `Bearer ${key}`} : {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ model: upstreamModel, messages, stream: true }) });
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
