import { accessSync, constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverClaude, discoverCodex } from './model-discovery.mjs';
import { cleanEnvironment } from './providers.mjs';

const execute = promisify(execFile);
const VALID_ID = /^[a-zA-Z0-9_.:/-]{1,180}$/;
export function executable(path) { try { accessSync(path, constants.X_OK); return true; } catch { return false; } }

// Installation and login status only; a successful request is a separate observation.
export async function diagnostics(config, secrets) {
  const env = cleanEnvironment();
  return Promise.all(config.providers.map(async p => {
    const result = { providerID:p.id, checkedAt:new Date().toISOString(), installed:p.type === 'openai' || executable(p.cliPath), path:p.cliPath, version:'', auth:'Not checked', loggedIn:null, detail:'' };
    if (!result.installed) { result.detail = 'CLI is missing or not executable'; return result; }
    if (p.type === 'openai') {
      result.auth = secrets[p.id] ? 'API key configured' : p.id === 'commandcode' ? 'API key missing' : 'No API key (may not be required)';
      result.detail = 'A test request confirms access and model availability';
      return result;
    }
    const run = (args, timeout) => execute(p.cliPath, args, { timeout, maxBuffer:16384, env });
    try {
      result.version = (await run(['--version'], 5000)).stdout.trim().slice(0, 100);
      if (p.type === 'claude') {
        const info = JSON.parse((await run(['auth', 'status'], 7000)).stdout);
        result.loggedIn = Boolean(info.loggedIn && info.authMethod === 'claude.ai');
        result.auth = result.loggedIn ? 'Subscription login confirmed' : info.loggedIn ? 'Different login; check subscription' : 'Not signed in';
      }
      if (p.type === 'codex') {
        const info = await run(['login', 'status'], 7000);
        result.loggedIn = /ChatGPT/i.test(info.stdout + info.stderr);
        result.auth = result.loggedIn ? 'ChatGPT login confirmed' : 'No confirmed ChatGPT login';
      }
      if (p.type === 'antigravity') result.detail = 'Antigravity CLI found. Text-only isolation is currently blocked; model discovery does not confirm inference access.';
    } catch { result.detail = 'CLI check failed; sign in again or check the path'; }
    return result;
  }));
}

export async function discoverModels(provider, key, signal) {
  if (provider.type === 'claude') return discoverClaude(provider, signal);
  if (provider.type === 'codex') return discoverCodex(provider, signal);
  if (provider.type === 'antigravity') {
    const result = await execute(provider.cliPath, ['models'], { timeout:15000, maxBuffer:256 * 1024, signal, env:cleanEnvironment() });
    return result.stdout.split('\n').filter(line => line.includes('\t')).map(line => {
      const [id, ...name] = line.split('\t');
      return { id, name:name.join(' ').trim() || id, source:'Antigravity CLI' };
    }).filter(m => VALID_ID.test(m.id));
  }
  if (provider.type === 'openai') {
    const response = await fetch(provider.baseURL + '/models', { headers:key ? { Authorization:`Bearer ${key}` } : {}, signal, redirect:'error' });
    if (!response.ok) { await response.body?.cancel(); throw Error(`Could not fetch models (HTTP ${response.status})`); }
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw Error('Model response too large');
    const result = JSON.parse(text);
    return (result.data || []).filter(m => typeof m.id === 'string' && VALID_ID.test(m.id)).slice(0, 300).map(m => ({ id:m.id, name:m.name || m.id, source:'Provider API' }));
  }
  throw Error('This CLI has no supported model list. Add model IDs manually.');
}
