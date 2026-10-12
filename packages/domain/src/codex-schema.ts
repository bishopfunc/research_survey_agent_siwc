// Codex structured output uses strict JSON Schema: every property must be required, optional ones are expressed as nullable.
// Application validation remains authoritative.
type Schema = Record<string, unknown>;
/** Formats the structured-output API accepts; others (uniqueItems, minLength…) are checked by the app afterwards. */
const SUPPORTED_FORMATS = ['date', 'date-time'];
/** `uri` is not accepted by the API, so URL fields get an http(s) pattern limited to RFC 3986 characters (non-ASCII must be percent-encoded). */
export const HTTP_URL_PATTERN = "^https?://[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%]+$";

const allowsNull = (schema: Schema | undefined): boolean => !!schema && (
  (Array.isArray(schema.type) ? schema.type.includes('null') : schema.type === 'null')
  || (Array.isArray(schema.anyOf) && (schema.anyOf as Schema[]).some(allowsNull))
  || (Array.isArray(schema.enum) && schema.enum.includes(null)));

export function codexOutputSchema(schema: Schema): Schema {
  const out: Schema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (['type', 'enum', 'additionalProperties', '$ref'].includes(key)) out[key] = value;
    else if (key === 'format' && SUPPORTED_FORMATS.includes(value as string)) out[key] = value;
    else if (key === 'format' && value === 'uri') out.pattern = HTTP_URL_PATTERN;
    else if (key === '$defs') out[key] = Object.fromEntries(Object.entries(value as Record<string, Schema>).map(([name, child]) => [name, codexOutputSchema(child)]));
    else if (key === 'items') out[key] = codexOutputSchema(value as Schema);
    else if (key === 'anyOf') out[key] = (value as Schema[]).map(codexOutputSchema);
  }
  if (schema.properties) {
    const required = new Set((schema.required as string[] | undefined) ?? []);
    out.properties = Object.fromEntries(Object.entries(schema.properties as Record<string, Schema>).map(([name, child]) => {
      const projected = codexOutputSchema(child);
      return [name, required.has(name) || allowsNull(projected) ? projected : { anyOf: [projected, { type: 'null' }] }];
    }));
    out.required = Object.keys(schema.properties as Schema);
  }
  return out;
}

/** Patch schema for research runs: Codex may only create unverified Evidence and never a content hash. */
export function codexPatchSchema(patch: Schema): Schema {
  const out = codexOutputSchema(patch);
  const evidence = ((out.$defs as Record<string, Schema> | undefined)?.Evidence?.properties) as Record<string, Schema> | undefined;
  if (!evidence) throw Error('Evidence definition is missing from the patch schema');
  evidence.verification = { type: 'string', enum: ['unverified'] };
  evidence.content_hash = { type: 'null' };
  return out;
}

/** Drops the nulls Codex had to send for optional fields whose app schema does not accept null (e.g. code_availability). */
export function stripCodexNulls(patch: unknown, defs: Record<string, Schema>): unknown {
  const clean = structuredClone(patch) as { operations?: { entity?: Record<string, unknown> }[] };
  for (const op of clean?.operations ?? []) {
    const entity = op?.entity; const def = entity && defs[String(entity.type)];
    if (!entity || !def) continue;
    const required = new Set((def.required as string[] | undefined) ?? []);
    const properties = (def.properties ?? {}) as Record<string, Schema>;
    for (const [key, value] of Object.entries(entity)) if (value === null && !required.has(key) && !allowsNull(properties[key])) delete entity[key];
  }
  return clean;
}
