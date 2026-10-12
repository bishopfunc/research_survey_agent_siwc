export function labelKey(text: string): string | null {
  const m = text.match(/(?:^|[\s:：(（])(fig(?:ure)?\.?|table|tab\.|algorithm|alg\.|図|表)\s*((?:[A-Z]\.?)?\d+(?:\.\d+)*)/i);
  if (!m) return null;
  const kind = /^(fig|図)/i.test(m[1]) ? 'figure' : /^(tab|表)/i.test(m[1]) ? 'table' : 'algorithm';
  const number = m[2].toLowerCase().replace(/^([a-z])(\d)/, '$1.$2');
  return `${kind}:${number}`;
}
export const figureKey = (text: string) => { const key = labelKey(text); return key?.startsWith('figure:') ? key.slice(7) : null; };
/** Keep a unique named match; otherwise show the first available actual figure with its own label. */
export function cardFigure<T extends { label: string; images: string[] }>(figures: T[], note?: string): T | null {
  const available = figures.filter(f => f.images.length > 0);
  const key = note ? labelKey(note) : null;
  const matches = key ? available.filter(f => labelKey(f.label) === key) : [];
  return matches.length === 1 ? matches[0] : available[0] ?? null;
}
