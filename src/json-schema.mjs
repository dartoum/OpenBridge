// A small JSON Schema checker for CLIs that cannot enforce a schema themselves (Antigravity). It covers what
// generated schemas (Zod, Pydantic) use; any other keyword is refused up front rather than silently unchecked.
const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', 'format', 'deprecated', 'readOnly', 'writeOnly', 'name']);
const KEYWORDS = new Set(['type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems',
  'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'anyOf', 'oneOf', 'allOf', '$ref', '$defs', 'definitions']);

export function unsupportedKeyword(schema, path = 'schema') {
  if (schema === true || schema === false || schema === undefined) return undefined;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return `${path} is not a schema object`;
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key)) return `${path} uses "${key}"`;
  if (schema.$ref !== undefined && !/^#\/(\$defs|definitions)\/[^/]+$/.test(schema.$ref)) return `${path} uses a $ref other than #/$defs/…`;
  const children = [...Object.entries(schema.properties || {}).map(([k, v]) => [`${path}.${k}`, v]), [`${path}[]`, schema.items],
    ...(typeof schema.additionalProperties === 'object' ? [[`${path}.*`, schema.additionalProperties]] : []),
    ...['anyOf', 'oneOf', 'allOf'].flatMap(name => (schema[name] || []).map((v, i) => [`${path}.${name}[${i}]`, v])),
    ...Object.entries({ ...schema.$defs, ...schema.definitions }).map(([k, v]) => [`${path}.$defs.${k}`, v])];
  for (const [childPath, child] of children) { const problem = unsupportedKeyword(child, childPath); if (problem) return problem; }
  return undefined;
}

const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
const matchesType = (type, value) => type === kind(value) || (type === 'number' && kind(value) === 'integer');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Returns the first problem as text, or undefined when the value conforms.
export function schemaProblem(schema, value, root = schema, path = 'value') {
  if (schema === true || schema === undefined) return undefined;
  if (schema === false) return `${path} is not allowed`;
  if (schema.$ref !== undefined) {
    const target = (root.$defs || root.definitions || {})[schema.$ref.split('/').pop()];
    if (!target) return `${path}: unresolved ${schema.$ref}`;
    return schemaProblem(target, value, root, path);
  }
  if (schema.type !== undefined) {
    const types = [].concat(schema.type);
    if (!types.some(type => matchesType(type, value))) return `${path} should be ${types.join(' or ')}, not ${kind(value)}`;
  }
  if (schema.enum && !schema.enum.some(option => same(option, value))) return `${path} is not one of ${JSON.stringify(schema.enum)}`;
  if ('const' in schema && !same(schema.const, value)) return `${path} should be ${JSON.stringify(schema.const)}`;
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) return `${path} is shorter than ${schema.minLength}`;
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) return `${path} is longer than ${schema.maxLength}`;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) return `${path} does not match ${schema.pattern}`;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} is below ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} is above ${schema.maximum}`;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return `${path} must be above ${schema.exclusiveMinimum}`;
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return `${path} must be below ${schema.exclusiveMaximum}`;
    if (schema.multipleOf !== undefined && !Number.isInteger(value / schema.multipleOf)) return `${path} is not a multiple of ${schema.multipleOf}`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path} has fewer than ${schema.minItems} items`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} has more than ${schema.maxItems} items`;
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) return `${path} has duplicate items`;
    for (let i = 0; i < value.length; i++) { const problem = schemaProblem(schema.items, value[i], root, `${path}[${i}]`); if (problem) return problem; }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) return `${path}.${key} is missing`;
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties && key in schema.properties) { const problem = schemaProblem(schema.properties[key], item, root, `${path}.${key}`); if (problem) return problem; }
      else if (schema.additionalProperties === false) return `${path}.${key} is not allowed`;
      else if (typeof schema.additionalProperties === 'object') { const problem = schemaProblem(schema.additionalProperties, item, root, `${path}.${key}`); if (problem) return problem; }
    }
  }
  for (const part of schema.allOf || []) { const problem = schemaProblem(part, value, root, path); if (problem) return problem; }
  if (schema.anyOf && schema.anyOf.every(part => schemaProblem(part, value, root, path))) return `${path} matches none of the allowed shapes`;
  if (schema.oneOf && schema.oneOf.filter(part => !schemaProblem(part, value, root, path)).length !== 1) return `${path} must match exactly one of the allowed shapes`;
  return undefined;
}
