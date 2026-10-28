// The one rule OpenBridge may add to agy's CLI settings, and only when the user turns on function calling on the Google
// page: it lets agy deliver calls to the bridge's own MCP server (openbridge_c, which exists only inside a bridge
// request and executes nothing). Without it agy refuses the call before it reaches the server, and its events carry
// only a shortened copy of long arguments. The file belongs to the agy CLI (not the Antigravity desktop app): every
// other setting is preserved, a file that does not parse is never overwritten, and turning the switch off removes
// exactly this rule.
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const AGY_TOOL_PERMISSION = 'mcp(openbridge_c/*)';
export const agySettingsPath = () => process.env.AGY_SETTINGS_PATH || join(homedir(), '.gemini/antigravity-cli/settings.json');

function readSettings(path) {
  if (!existsSync(path)) return {};
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('settings are not a JSON object');
  return settings;
}

// true/false, or null when the settings cannot be read (the reason is in `error`).
export function agyToolPermission(path = agySettingsPath()) {
  try { return { allowed:(readSettings(path).permissions?.allow || []).includes(AGY_TOOL_PERMISSION) }; }
  catch (error) { return { allowed:null, error:`Cannot read ${path}: ${error.message}` }; }
}

export function setAgyToolPermission(allowed, path = agySettingsPath()) {
  if (!existsSync(dirname(path))) throw Error(`Antigravity CLI settings folder not found (${dirname(path)}). Run agy once, then try again.`);
  let settings;
  try { settings = readSettings(path); } catch (error) { throw Error(`Not changed: ${path} could not be read (${error.message}).`); }
  const permissions = settings.permissions && typeof settings.permissions === 'object' ? settings.permissions : {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow.filter(rule => rule !== AGY_TOOL_PERMISSION) : [];
  if (allowed) allow.push(AGY_TOOL_PERMISSION);
  const next = { ...settings, permissions:{ ...permissions, allow } };
  const temporary = `${path}.openbridge-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode:existsSync(path) ? statSync(path).mode & 0o777 : 0o600 });
  renameSync(temporary, path);
  return agyToolPermission(path);
}
