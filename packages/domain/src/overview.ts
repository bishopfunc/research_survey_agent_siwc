import type { Entity } from './snapshot.types';

/** The overview (概要) of an item: one sentence that explains it, common to issues, methods, papers, knowledge, the
 * literature guide and the tutorial (design 0026). Each type keeps it in its existing one-sentence field. */
export function overviewOf(entity: Entity): string {
  switch (entity.type) {
    case 'Paper': return entity.one_line_summary;
    case 'Issue': case 'Method': case 'Concept': case 'Domain': return entity.description;
    case 'Keyword': return entity.meaning;
    case 'Resource': return entity.summary;
    case 'Tutorial': return entity.summary ?? '';
    default: return '';
  }
}
/** The Evidence IDs that source the overview: the paper's summary sources, or the item's own sources. A literature guide
 * entry is its own source, and the tutorial cites in its body. */
export function overviewSources(entity: Entity): string[] {
  switch (entity.type) {
    case 'Paper': return entity.reading?.cites?.summary ?? [];
    case 'Issue': case 'Method': case 'Concept': case 'Keyword': return entity.evidence ?? [];
    default: return [];
  }
}
