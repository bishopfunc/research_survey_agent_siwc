import type { Entity, Relation, SurveySnapshot } from './snapshot.types';

export type LinkType = Relation['type'] | 'claims' | 'evidence' | 'papers' | 'related';
export interface Connection { entity: Entity; links: { type: LinkType; outgoing: boolean }[] }
const fields = ['proposes', 'addresses', 'claims', 'evidence', 'papers', 'related'] as const;
const typeOrder: Entity['type'][] = ['Domain', 'Concept', 'Issue', 'Method', 'Paper', 'Claim', 'Evidence', 'Keyword'];

/** Direct neighbours of one entity, merging reference arrays and typed relations without duplicates. */
export function buildConnections(snapshot: SurveySnapshot, id: string): Connection[] {
  const byId = new Map(snapshot.entities.map(e => [e.id, e]));
  if (!byId.has(id)) return [];
  const found = new Map<string, Connection>();
  const add = (other: string, type: LinkType, outgoing: boolean) => {
    const entity = byId.get(other);
    if (!entity || other === id) return;
    const connection = found.get(other) ?? { entity, links: [] };
    if (!connection.links.some(l => l.type === type && l.outgoing === outgoing)) connection.links.push({ type, outgoing });
    found.set(other, connection);
  };
  for (const e of snapshot.entities) for (const field of fields) {
    const refs = (e as unknown as Record<string, unknown>)[field];
    if (!Array.isArray(refs)) continue;
    if (e.id === id) refs.forEach(ref => add(String(ref), field, true));
    else if (refs.includes(id)) add(e.id, field, false);
  }
  for (const r of snapshot.relations) {
    if (r.from === id) add(r.to, r.type, true);
    else if (r.to === id) add(r.from, r.type, false);
  }
  return [...found.values()].sort((a, b) => typeOrder.indexOf(a.entity.type) - typeOrder.indexOf(b.entity.type) || a.entity.label.localeCompare(b.entity.label));
}
