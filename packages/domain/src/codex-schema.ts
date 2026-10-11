// Codex accepts a subset of JSON Schema. Application validation remains authoritative.
type Schema = Record<string, unknown>;
export function codexOutputSchema(schema: Schema): Schema {
  const out: Schema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (['type', 'enum', 'required', 'additionalProperties', '$ref'].includes(key)) out[key] = value;
    else if (key === 'properties' || key === '$defs') out[key] = Object.fromEntries(Object.entries(value as Record<string, Schema>).map(([name, child]) => [name, codexOutputSchema(child)]));
    else if (key === 'items') out[key] = codexOutputSchema(value as Schema);
    else if (key === 'anyOf') out[key] = (value as Schema[]).map(codexOutputSchema);
  }
  return out;
}
