import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { sortModels } from './model-families.mjs';

export const legacySelections = { sonnet:'claude/sonnet', opus:'claude/opus', haiku:'claude/haiku', codex:'chatgpt/default', 'gemini-auto':'google/gemini-3.8-flash-medium', 'gemini-pro':'google/gemini-4-argon-medium', 'gemini-flash':'google/gemini-3.8-flash-medium', commandcode:'commandcode/deepseek/deepseek-v4-flash' };
export const MAX_MODELS = 1000;
export const EFFORT_PATTERN = /^[a-z][a-z0-9_-]{0,23}$/;
const PROVIDER_FIELDS = ['id', 'name', 'type', 'enabled', 'cliPath', 'baseURL', 'models'];
const MODEL_FIELDS = ['id', 'upstreamModel', 'name', 'enabled', 'source', 'resolvedModel', 'efforts', 'defaultEffort', 'effort'];
const MODEL_ID = /^[a-zA-Z0-9_.:/-]{1,220}$/;
const UPSTREAM_ID = /^[a-zA-Z0-9_.:/-]{1,180}$/;

const model = (provider, upstreamModel, name) => ({ id:`${provider}/${upstreamModel}`, upstreamModel, name, enabled:true });
export function defaultConfig() {
  return { version:1, selectedModel:'claude/sonnet', providers:[
    { id:'claude', name:'Claude Pro', type:'claude', enabled:true, cliPath:process.env.CLAUDE_BIN || join(homedir(),'.local/bin/claude'), baseURL:'', models:[model('claude','sonnet','Sonnet'),model('claude','opus','Opus'),model('claude','haiku','Haiku')] },
    { id:'chatgpt', name:'ChatGPT', type:'codex', enabled:true, cliPath:process.env.CODEX_BIN || join(homedir(),'.local/bin/codex'), baseURL:'', models:[model('chatgpt','default','Codex · default model')] },
    { id:'google', name:'Google AI Pro', type:'antigravity', enabled:true, cliPath:process.env.AGY_BIN || join(homedir(),'.local/bin/agy'), baseURL:'', models:[model('google','gemini-3.8-flash-medium','Gemini 3.8 Flash (Medium)'),model('google','gemini-4-argon-medium','Gemini 4 Argon (Medium)')] },
    { id:'commandcode', name:'Command Code GOAT', type:'openai', enabled:true, cliPath:'', baseURL:'https://api.commandcode.ai/provider/v1', models:[model('commandcode','deepseek/deepseek-v4-flash','DeepSeek V4 Flash')] },
  ] };
}

// Effective availability in configuration order; legacy provider aliases pick the first enabled model.
export function availableModels(config) {
  return config.providers.flatMap(provider => provider.models.map(model => ({ ...model, providerID:provider.id, enabled:provider.enabled && model.enabled })));
}

// Effective availability plus display grouping; the management UI renders models in this order.
export function catalog(config) {
  return config.providers.flatMap(provider => sortModels(provider.models).map(({ model, info }) => ({
    ...model, providerID:provider.id, providerName:provider.name, providerType:provider.type,
    enabled:provider.enabled && model.enabled,
    family:info.family, familyName:info.familyName, version:info.version, alias:info.alias,
  })));
}

export function validBaseURL(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw Error('Endpoint must not contain credentials, query or fragment');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('Use HTTPS, or HTTP on localhost');
  return value.replace(/\/$/, '');
}

const text = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;

function validateModel(provider, m, seen) {
  const valid = m && typeof m.id === 'string' && m.id.startsWith(provider.id + '/') && MODEL_ID.test(m.id) && !seen.has(m.id)
    && typeof m.upstreamModel === 'string' && UPSTREAM_ID.test(m.upstreamModel)
    && text(m.name, 180) && typeof m.enabled === 'boolean'
    && Object.keys(m).every(k => MODEL_FIELDS.includes(k));
  if (!valid) throw Error('Invalid or duplicate model');
  if (m.source !== undefined && (typeof m.source !== 'string' || m.source.length > 160)) throw Error('Invalid model source');
  if (m.resolvedModel !== undefined && (typeof m.resolvedModel !== 'string' || m.resolvedModel.length > 220)) throw Error('Invalid resolved model');
  if (m.efforts !== undefined && (!Array.isArray(m.efforts) || m.efforts.length > 12 || !m.efforts.every(e => typeof e === 'string' && EFFORT_PATTERN.test(e)))) throw Error('Invalid model effort levels');
  if (m.defaultEffort !== undefined && (typeof m.defaultEffort !== 'string' || !EFFORT_PATTERN.test(m.defaultEffort))) throw Error('Invalid default effort');
  if (m.effort !== undefined && !m.efforts?.includes(m.effort)) throw Error(`Effort ${m.effort} is not supported by ${m.id}`);
  seen.add(m.id);
}

export function validateConfig(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.providers) || value.providers.length > 50) throw Error('Invalid configuration');
  if (Object.keys(value).some(k => !['version', 'providers', 'selectedModel'].includes(k))) throw Error('Unknown configuration field');
  const providers = new Set(), models = new Set();
  for (const p of value.providers) {
    const valid = p && /^[a-z][a-z0-9-]{0,50}$/.test(p.id) && !providers.has(p.id) && text(p.name, 120)
      && ['claude', 'codex', 'antigravity', 'openai'].includes(p.type) && typeof p.enabled === 'boolean'
      && Array.isArray(p.models) && p.models.length <= MAX_MODELS && typeof p.cliPath === 'string' && typeof p.baseURL === 'string';
    if (!valid) throw Error('Invalid provider');
    if (Object.keys(p).some(k => !PROVIDER_FIELDS.includes(k))) throw Error('Unknown provider field; credentials belong in Keychain');
    providers.add(p.id);
    if (p.type === 'openai') p.baseURL = validBaseURL(p.baseURL);
    else if (!p.cliPath.startsWith('/') || p.cliPath.length > 2048) throw Error('CLI path must be absolute');
    for (const m of p.models) validateModel(p, m, models);
  }
  if (typeof value.selectedModel !== 'string' || !availableModels(value).some(m => m.id === value.selectedModel && m.enabled)) throw Error('Select an enabled model');
  return value;
}

export function loadConfig(path) {
  if (!path) return defaultConfig();
  try {
    const value = validateConfig(JSON.parse(readFileSync(path, 'utf8')));
    const shipped = value.providers.find(p => p.id === 'chatgpt')?.models.find(m => m.id === 'chatgpt/default');
    if (shipped?.name === 'Codex · standaardmodel') shipped.name = 'Codex · default model';
    return value;
  } catch (e) {
    if (e.code === 'ENOENT') return defaultConfig();
    throw e;
  }
}

export function saveConfig(path, value) {
  validateConfig(value);
  if (!path) return;
  mkdirSync(dirname(path), { recursive:true });
  const temp = path + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode:0o600 });
  renameSync(temp, path);
}

export function resolveConfiguredModel(config, requested) {
  const all = availableModels(config);
  const aliases = { 'claude-subscription':'claude', 'chatgpt-subscription':'chatgpt', 'gemini-subscription':'google', 'commandcode-goat':'commandcode' };
  const id = requested === 'subscription' ? config.selectedModel : legacySelections[requested] || requested;
  if (aliases[id]) {
    const selected = all.find(m => m.id === config.selectedModel && m.providerID === aliases[id] && m.enabled);
    return selected || all.find(m => m.providerID === aliases[id] && m.enabled);
  }
  return all.find(m => m.id === id && m.enabled);
}
