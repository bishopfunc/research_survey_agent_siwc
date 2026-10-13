// Codex structured output uses strict JSON Schema: every property must be required, optional ones are expressed as nullable.
// Application validation remains authoritative.
import addFormats from 'ajv-formats';
type Schema = Record<string, unknown>;
/** Formats the structured-output API accepts; others (uniqueItems, minLength…) are checked by the app afterwards. */
const SUPPORTED_FORMATS = ['date', 'date-time'];
/** Characters a URL may hold raw (RFC 3986); anything else is percent-encoded. */
const URL_CHARS = "A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%";
/** `uri` is not accepted by the API, so URL fields get an http(s) pattern limited to RFC 3986 characters (non-ASCII must be percent-encoded). */
export const HTTP_URL_PATTERN = `^https?://[${URL_CHARS}]+$`;
const RAW_URL_CHARS = new RegExp(`[^${URL_CHARS}]+`, 'g');
/** Percent-encodes what HTTP_URL_PATTERN does not allow raw (non-ASCII, spaces, | { }…), keeping existing escapes; a broken surrogate is dropped. */
const encodeUrl = (url: string) => url.trim().replace(RAW_URL_CHARS, part => { try { return encodeURI(part); } catch { return ''; } });
/** The same date and date-time (RFC 3339, offset required) checks the app's ajv-formats applies. */
const formatCheck = (format: 'date' | 'date-time') => (addFormats.get(format) as unknown as { validate: (value: string) => boolean }).validate;
const isDate = formatCheck('date'), isDateTime = formatCheck('date-time');

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
export const KNOWLEDGE_CATEGORIES = ['dataset', 'benchmark', 'hardware', 'simulator', 'metric', 'sota', 'model', 'architecture', 'baseline'] as const;
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

/** Trimmed, non-empty strings, distinct unless `unique` is false, or undefined when the value is not a list of strings. */
function distinct(value: unknown, limit: number, length = Infinity, unique = true): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((v): v is string => typeof v === 'string').map(v => v.trim().slice(0, length)).filter(Boolean);
  return (unique ? [...new Set(items)] : items).slice(0, limit);
}
/** The definition behind a local $ref, or the non-null branch of a nullable anyOf (Paper.reading, Tutorial sections…). */
function resolve(schema: Schema | undefined, defs: Record<string, Schema>): Schema | undefined {
  if (typeof schema?.$ref === 'string') return resolve(defs[schema.$ref.split('/').at(-1)!], defs);
  if (Array.isArray(schema?.anyOf)) return resolve((schema.anyOf as Schema[]).find(s => !allowsNull(s)), defs);
  return schema;
}
/** Tidies a value against its app definition at any depth (reading.sources, a tutorial figure's caption_ja…): drops the nulls Codex had
 * to send for optional non-nullable keys, keeps the first strings of a capped list (distinct only where the app sets uniqueItems:
 * english_terms, while Resource.authors keeps two co-authors with the same name),
 * percent-encodes URLs, cuts a date that carries a time to its day and nulls a nullable date or date-time ajv would reject
 * (a date-time without an offset, 2026/10/13…), as the strict output schema would have required. */
function tidy(value: unknown, schema: Schema | undefined, defs: Record<string, Schema>, fill = true): unknown {
  const def = resolve(schema, defs);
  if (!def) return value;
  if (typeof value === 'string' && def.format === 'uri') return encodeUrl(value);
  if (typeof value === 'string' && (def.format === 'date' || def.format === 'date-time')) {
    const text = value.trim(), day = def.format === 'date' ? /^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/i.exec(text)?.[1] : undefined;
    if (def.format === 'date' ? isDate(text) : isDateTime(text)) return text;
    if (day && isDate(day)) return day;
    return allowsNull(schema) || allowsNull(def) ? null : value;
  }
  if (Array.isArray(value)) return typeof def.maxItems === 'number' && (def.items as Schema | undefined)?.type === 'string' ? distinct(value, def.maxItems, Infinity, def.uniqueItems === true) : value.map(item => tidy(item, def.items as Schema | undefined, defs));
  if (value && typeof value === 'object' && def.properties) {
    const object = value as Record<string, unknown>, required = new Set((def.required as string[] | undefined) ?? []), properties = def.properties as Record<string, Schema>;
    for (const [key, child] of Object.entries(object)) if (child === null && !required.has(key) && !allowsNull(properties[key])) delete object[key]; else object[key] = tidy(child, properties[key], defs);
    // A free-text checkpoint leaves out the keys it has no value for (a Paper without doi); the strict output sends null or [].
    // Not for a replaced entity itself: a key it leaves out keeps the stored value (streamCheckpoints), never null.
    if (fill) for (const key of required) if (object[key] === undefined && properties[key]) { if (allowsNull(properties[key])) object[key] = null; else if (resolve(properties[key], defs)?.type === 'array') object[key] = []; }
  }
  return value;
}
/** Drops the nulls Codex had to send for optional fields whose app schema does not accept null (e.g. code_availability),
 * and tidies what is mechanical to fix (follow-ups, capped lists, reading lists, URLs, dates, Evidence status, an empty Resource title)
 * so it never needs a repair run.
 * Free-text checkpoints skip the strict output schema, so this also applies the rules that schema enforces. */
export function stripCodexNulls(patch: unknown, defs: Record<string, Schema>): unknown {
  const clean = structuredClone(patch) as { operations?: { op?: unknown; entity?: Record<string, unknown> }[]; follow_ups?: unknown };
  if (clean && typeof clean === 'object' && 'follow_ups' in clean) {
    const asked = distinct(clean.follow_ups, 3, 200);
    if (asked?.length) clean.follow_ups = asked; else delete clean.follow_ups;
  }
  for (const op of clean?.operations ?? []) {
    const entity = op?.entity; const def = entity && defs[String(entity.type)];
    if (!entity || !def) continue;
    // Codex creates only unverified Evidence without a content hash (codexPatchSchema).
    if (entity.type === 'Evidence') { entity.verification = 'unverified'; entity.content_hash = null; }
    // A page whose title Codex could not read comes back with title "" (a real outline checkpoint); its label names it.
    // A sparse replace that leaves title out keeps the stored title (streamCheckpoints), so only a sent or required title falls back.
    if (entity.type === 'Resource' && (op.op !== 'replace_entity' || 'title' in entity) && !(typeof entity.title === 'string' && entity.title.trim()) && typeof entity.label === 'string' && entity.label.trim()) entity.title = entity.label.trim();
    // A lister submits papers with only what it saw (design 0037): an added entity without a label is named by its title, and
    // anything Codex adds is codex-made.
    if (op.op === 'add_entity') {
      if (!(typeof entity.label === 'string' && entity.label.trim()) && typeof entity.title === 'string' && entity.title.trim()) entity.label = entity.title.trim().slice(0, 80);
      if (entity.provenance === undefined) entity.provenance = 'codex';
    }
    const reading = entity.type === 'Paper' ? entity.reading as Record<string, unknown> | null | undefined : undefined;
    if (reading && typeof reading === 'object') {
      for (const key of ['contributions', 'key_figures', 'key_formulas', 'key_sections', 'captions_ja']) { const items = reading[key] === null ? [] : distinct(reading[key], Infinity); if (items) reading[key] = items; }
      for (const key of ['novelty', 'key_idea', 'validation', 'discussion']) if (typeof reading[key] === 'string') reading[key] = (reading[key] as string).trim();
      // Per-field sources: null keys (strict output) are dropped, and so is an empty cites object.
      if (reading.cites === null) delete reading.cites;
      else if (reading.cites && typeof reading.cites === 'object') {
        const cites = reading.cites as Record<string, unknown>;
        for (const [key, value] of Object.entries(cites)) { const ids = distinct(value, Infinity); if (ids?.length) cites[key] = ids; else delete cites[key]; }
        if (!Object.keys(cites).length) delete reading.cites;
        // reading.evidence lists every source of the reading, including the per-field ones.
        else reading.evidence = [...new Set([...(Array.isArray(reading.evidence) ? reading.evidence : []), ...Object.values(cites).flat()])];
      }
      if (Array.isArray(reading.sources)) {
        const seen = new Set<string>();
        reading.sources = reading.sources.flatMap(source => {
          const url = typeof source?.url === 'string' ? source.url.trim() : '', locator = typeof source?.locator === 'string' ? source.locator.trim() : '';
          if (!/^https?:\/\/\S+$/.test(url) || seen.has(`${url} ${locator}`)) return [];
          seen.add(`${url} ${locator}`); return [{ url, locator: locator || 'Abstract' }];
        });
      }
      if (Object.entries(reading).filter(([key]) => key !== 'sources' && key !== 'cites').every(([, v]) => Array.isArray(v) ? !v.length : !v)) entity.reading = null;
    }
    tidy(entity, def, defs, op.op !== 'replace_entity');
  }
  return clean;
}
