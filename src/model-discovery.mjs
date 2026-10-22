import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanEnvironment } from './providers.mjs';
import { EFFORT_PATTERN, MAX_MODELS } from './config.mjs';

const execute = promisify(execFile);
const VALID_ID = /^[a-zA-Z0-9_.:/-]{1,180}$/;
const efforts = levels => {
  const valid = Array.isArray(levels) ? levels.filter(e => typeof e === 'string' && EFFORT_PATTERN.test(e)).slice(0, 12) : [];
  return valid.length ? { efforts:valid } : {};
};

export function claudeCatalogue(binary, signal) {
  return new Promise((resolve, reject) => {
    const cwd = mkdtempSync(join(tmpdir(), 'openbridge-models-'));
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--safe-mode', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-session-persistence'];
    const child = spawn(binary, args, { cwd, env:cleanEnvironment(), stdio:['pipe', 'pipe', 'pipe'] });
    let buffer = '', models, failure;
    const stop = () => child.kill('SIGTERM');
    const timer = setTimeout(() => { failure = Error('Claude model discovery timed out'); stop(); }, 18000);
    signal?.addEventListener('abort', stop, { once:true });
    if (signal?.aborted) stop();
    child.stdout.setEncoding('utf8');
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.stdout.on('data', data => {
      buffer += data;
      if (buffer.length > 2 * 1024 * 1024) { failure = Error('Model catalogue too large'); stop(); return; }
      let n;
      while ((n = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, n);
        buffer = buffer.slice(n + 1);
        try {
          const event = JSON.parse(line);
          if (event.type !== 'control_response' || event.response?.request_id !== 'openbridge-models') continue;
          models = event.response?.response?.models;
          if (!Array.isArray(models)) failure = Error('Claude CLI did not return a model catalogue');
          child.stdin.end();
        } catch { failure = Error('Invalid Claude catalogue response'); stop(); }
      }
    });
    child.once('error', error => { failure = error; });
    child.once('close', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      rmSync(cwd, { recursive:true, force:true });
      if (signal?.aborted) reject(Error('Model discovery cancelled'));
      else if (failure || !models) reject(failure || Error('No Claude model catalogue returned'));
      else resolve(models);
    });
    // Initialization only: no prompt is sent, so discovery consumes no inference quota.
    child.stdin.write(JSON.stringify({ type:'control_request', request_id:'openbridge-models', request:{ subtype:'initialize' } }) + '\n');
  });
}

// Family aliases (`haiku`) stay as rows so they can head their family; each alias also yields its explicit version.
// `default` is skipped: it duplicates an alias and the bridge's own `subscription` alias already follows the selection.
export function claudeModelRows(models) {
  const rows = new Map();
  for (const m of models) {
    if (typeof m.value !== 'string' || m.value === 'default') continue;
    const resolved = typeof m.resolvedModel === 'string' ? m.resolvedModel : m.value;
    const levels = efforts(m.supportsEffort === false ? [] : m.supportedEffortLevels);
    rows.set(m.value, { id:m.value, name:m.displayName || m.value, source:'Claude CLI', resolvedModel:resolved, ...levels });
    if (resolved.startsWith('claude-') && !rows.has(resolved)) rows.set(resolved, { id:resolved, name:m.displayName || resolved, source:'Claude CLI', resolvedModel:resolved, ...levels });
  }
  return [...rows.values()].filter(m => VALID_ID.test(m.id));
}

// Only what the Claude CLI itself reports: that is what this account's CLI can run. A CLI update refreshes the list.
export async function discoverClaude(provider, signal) {
  return claudeModelRows(await claudeCatalogue(provider.cliPath, signal)).slice(0, MAX_MODELS);
}

export async function discoverCodex(provider, signal) {
  const cwd = mkdtempSync(join(tmpdir(), 'openbridge-models-'));
  try {
    const { stdout } = await execute(provider.cliPath, ['-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"', 'debug', 'models'], { cwd, env:cleanEnvironment(), signal, timeout:18000, maxBuffer:8 * 1024 * 1024 });
    const value = JSON.parse(stdout);
    const models = Array.isArray(value) ? value : value.models;
    if (!Array.isArray(models)) throw Error('Codex returned no model catalogue');
    return models.filter(m => typeof m.slug === 'string' && VALID_ID.test(m.slug) && m.visibility !== 'hide').slice(0, MAX_MODELS).map(m => {
      const levels = efforts((m.supported_reasoning_levels || []).map(level => typeof level === 'string' ? level : level?.effort));
      const fallback = levels.efforts?.includes(m.default_reasoning_level) ? { defaultEffort:m.default_reasoning_level } : {};
      return { id:m.slug, name:m.display_name || m.slug, source:'Codex CLI catalogue', resolvedModel:m.slug, ...levels, ...fallback };
    });
  } finally { rmSync(cwd, { recursive:true, force:true }); }
}
