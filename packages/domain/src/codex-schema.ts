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

/** Knowledge categories Codex may use; task, concept, method and other remain in the DSL only for data saved earlier. */
export const KNOWLEDGE_CATEGORIES = ['dataset', 'benchmark', 'hardware', 'simulator', 'metric', 'sota', 'model', 'baseline'] as const;
/** Patch schema for research runs: Codex may only create unverified Evidence and never a content hash,
 * and knowledge uses the current categories. */
export function codexPatchSchema(patch: Schema): Schema {
  const out = codexOutputSchema(patch);
  const defs = out.$defs as Record<string, Schema> | undefined;
  const evidence = defs?.Evidence?.properties as Record<string, Schema> | undefined;
  const keyword = defs?.Keyword?.properties as Record<string, Schema> | undefined;
  if (!evidence || !keyword) throw Error('Evidence or Keyword definition is missing from the patch schema');
  evidence.verification = { type: 'string', enum: ['unverified'] };
  evidence.content_hash = { type: 'null' };
  keyword.category = { type: 'string', enum: [...KNOWLEDGE_CATEGORIES] };
  return out;
}

/** Trimmed, non-empty, distinct strings, or undefined when the value is not a list of strings. */
function distinct(value: unknown, limit: number, length = Infinity): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((v): v is string => typeof v === 'string').map(v => v.trim().slice(0, length)).filter(Boolean))].slice(0, limit);
}
/** Drops the nulls Codex had to send for optional fields whose app schema does not accept null (e.g. code_availability),
 * and tidies list fields that are mechanical to fix (follow-ups, English issue terms, reading lists) so they never need a repair run. */
export function stripCodexNulls(patch: unknown, defs: Record<string, Schema>): unknown {
  const clean = structuredClone(patch) as { operations?: { entity?: Record<string, unknown> }[]; follow_ups?: unknown };
  if (clean && typeof clean === 'object' && 'follow_ups' in clean) {
    const asked = distinct(clean.follow_ups, 3, 200);
    if (asked?.length) clean.follow_ups = asked; else delete clean.follow_ups;
  }
  for (const op of clean?.operations ?? []) {
    const entity = op?.entity; const def = entity && defs[String(entity.type)];
    if (!entity || !def) continue;
    const required = new Set((def.required as string[] | undefined) ?? []);
    const properties = (def.properties ?? {}) as Record<string, Schema>;
    for (const [key, value] of Object.entries(entity)) if (value === null && !required.has(key) && !allowsNull(properties[key])) delete entity[key];
    if (entity.type === 'Issue' && 'english_terms' in entity) {
      const terms = distinct(entity.english_terms, 5);
      if (terms) entity.english_terms = terms;
    }
    const reading = entity.type === 'Paper' ? entity.reading as Record<string, unknown> | null | undefined : undefined;
    if (reading && typeof reading === 'object') {
      for (const key of ['contributions', 'key_figures']) { const items = distinct(reading[key], Infinity); if (items) reading[key] = items; }
      for (const key of ['novelty', 'key_idea', 'validation', 'discussion']) if (typeof reading[key] === 'string') reading[key] = (reading[key] as string).trim();
      if (Array.isArray(reading.sources)) {
        const seen = new Set<string>();
        reading.sources = reading.sources.flatMap(source => {
          const url = typeof source?.url === 'string' ? source.url.trim() : '', locator = typeof source?.locator === 'string' ? source.locator.trim() : '';
          if (!/^https?:\/\/\S+$/.test(url) || seen.has(`${url} ${locator}`)) return [];
          seen.add(`${url} ${locator}`); return [{ url, locator: locator || 'Abstract' }];
        });
      }
      if (Object.entries(reading).filter(([key]) => key !== 'sources').every(([, v]) => Array.isArray(v) ? !v.length : !v)) entity.reading = null;
    }
  }
  return clean;
}
