import type { Method, Paper, SurveySnapshot } from './snapshot.types';
import { buildEvolution, byPublication } from './evolution';

/** origin: the first registered proposal of a method. influence: citations per year in the survey's top quarter. */
export type ImportanceReason = 'origin' | 'influence';
export const IMPORTANCE_LABELS: Record<ImportanceReason, string> = { origin: 'Original', influence: 'Highly cited' };
export interface PaperImportance { reasons: ImportanceReason[]; citationsPerYear: number | null }
export interface RepresentativePaper { paper: Paper; reasons: ImportanceReason[]; methods: Method[] }

/** Citations per year since publication, counted up to the year the count was taken (inclusive). */
export function citationsPerYear(paper: Paper, currentYear: number): number | null {
  if (paper.citation_count === null || paper.year === null) return null;
  const asOf = Number(paper.citation_as_of?.slice(0, 4)) || currentYear;
  return paper.citation_count / Math.max(1, asOf - paper.year + 1);
}

/** Why each paper matters, from the survey alone: no outside ranking is consulted. */
export function assessPapers(snapshot: SurveySnapshot, currentYear = new Date().getFullYear()): Map<string, PaperImportance> {
  const evolution = buildEvolution(snapshot);
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  const rates = new Map(papers.map(p => [p.id, citationsPerYear(p, currentYear)]));
  const known = [...rates.values()].filter((r): r is number => r !== null).sort((a, b) => a - b);
  // The top quarter of the papers with a known count; with fewer than four, only the most cited.
  const threshold = known.length >= 4 ? known[Math.floor(0.75 * (known.length - 1))] : known.at(-1) ?? Infinity;
  return new Map(papers.map(paper => {
    const proposed = evolution.nodes.filter(n => n.papers.some(p => p.id === paper.id));
    const reasons: ImportanceReason[] = [];
    if (proposed.some(n => n.origin?.id === paper.id)) reasons.push('origin');
    if ((rates.get(paper.id) ?? -1) >= threshold) reasons.push('influence');
    return [paper.id, { reasons, citationsPerYear: rates.get(paper.id) ?? null }];
  }));
}

/** The papers to read first, judged overall: for each method the edition with the most reasons (then the more
 * cited per year, then the earlier), and every paper proposing no method that is influential (surveys, benchmarks). */
export function representativePapers(snapshot: SurveySnapshot, currentYear = new Date().getFullYear()): RepresentativePaper[] {
  const assessed = assessPapers(snapshot, currentYear);
  const evolution = buildEvolution(snapshot);
  const chosen = new Map<string, RepresentativePaper>();
  for (const node of evolution.nodes) {
    const best = [...node.papers].sort((a, b) => assessed.get(b.id)!.reasons.length - assessed.get(a.id)!.reasons.length
      || (assessed.get(b.id)!.citationsPerYear ?? -1) - (assessed.get(a.id)!.citationsPerYear ?? -1) || byPublication(a, b))[0];
    if (!best) continue;
    const entry = chosen.get(best.id) ?? { paper: best, reasons: assessed.get(best.id)!.reasons, methods: [] };
    entry.methods.push(node.method);
    chosen.set(best.id, entry);
  }
  for (const paper of snapshot.entities.filter((e): e is Paper => e.type === 'Paper'))
    if (!chosen.has(paper.id) && !evolution.nodes.some(n => n.papers.some(p => p.id === paper.id)) && assessed.get(paper.id)!.reasons.includes('influence'))
      chosen.set(paper.id, { paper, reasons: assessed.get(paper.id)!.reasons, methods: [] });
  return [...chosen.values()].sort((a, b) => byPublication(a.paper, b.paper));
}
