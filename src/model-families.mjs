// Derives display groups from model IDs: family, numeric version and dated snapshot.
// Grouping only affects presentation; routing always uses the configured model ID.
const ACRONYMS = { gpt: 'GPT', oss: 'OSS' };
const VARIANTS = ['low', 'medium', 'high'];

export function describeModel(upstreamModel) {
  const family = [], version = [];
  let snapshot = '', variant = '', latest = false;
  for (const token of upstreamModel.toLowerCase().split(/[-/_:]/).filter(Boolean)) {
    if (/^\d{8}$/.test(token)) snapshot = token;
    else if (/^v?\d+(\.\d+)*$/.test(token)) version.push(...token.replace(/^v/, '').split('.').map(Number));
    else if (token === 'latest') latest = true;
    else if (VARIANTS.includes(token) && family.length) variant = token;
    else if (family.at(-1) !== token) family.push(token);
  }
  return { family: family.join('-'), familyName: family.map(t => ACRONYMS[t] || t[0].toUpperCase() + t.slice(1)).join(' '), version, snapshot, variant, latest };
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? -1) !== (b[i] ?? -1)) return (b[i] ?? -1) - (a[i] ?? -1);
  return 0;
}

// Aliases (e.g. `haiku`) have no version of their own and are grouped by the model the CLI resolves them to.
export function modelInfo(model) {
  const own = describeModel(model.upstreamModel);
  const alias = own.version.length === 0 && Boolean(model.resolvedModel) && model.resolvedModel !== model.upstreamModel;
  const info = alias ? describeModel(model.resolvedModel) : own;
  return { family: info.family || 'other', familyName: info.familyName || 'Other', version: alias ? '' : info.version.join('.'), alias, versionKey: info.version, snapshot: info.snapshot, variant: info.variant };
}

// Families alphabetically; inside a family aliases first, then newest version, newest snapshot, highest variant.
export function sortModels(models) {
  const rows = models.map(model => ({ model, info: modelInfo(model) }));
  rows.sort((a, b) => a.info.familyName.localeCompare(b.info.familyName)
    || Number(b.info.alias) - Number(a.info.alias)
    || compareVersions(a.info.versionKey, b.info.versionKey)
    || b.info.snapshot.localeCompare(a.info.snapshot)
    || VARIANTS.indexOf(b.info.variant) - VARIANTS.indexOf(a.info.variant)
    || a.model.id.localeCompare(b.model.id));
  return rows;
}
