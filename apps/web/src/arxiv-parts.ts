/** The sections of a paper's arXiv HTML version needed to understand it (design 0026); no React, so tests can import it. */
export type ArxivSection = { number: string | null; title: string; anchor: string; text: string };
export type KeySection = { note: string | null; section: ArxivSection | null };

const NUMBER = /^\s*(?:§\s*|section\s+|sec\.?\s*|appendix\s+|第\s*)?([A-Z](?=[\s.:：節]|$)|\d+)((?:\.\d+)*)\s*節?/i;
/** "3.2 Pseudocode: why" / "Section 3.2" / "Sec 3" / "第3節" / "Appendix B: proofs" → "3.2" / "3.2" / "3" / "3" / "b".
 * A letter counts only as an appendix number. */
export function sectionNumber(note: string): string | null {
  return note.match(NUMBER)?.slice(1, 3).join('').toLowerCase() ?? null;
}
const METHOD = /\b(method|methodology|approach|algorithm|framework|proposed|model|architecture|overview|concept|design)\b|\bour\b/i;
const NOT_METHOD = /\b(introduction|related|background|preliminar|experiment|evaluation|result|conclusion|discussion|limitation|acknowledg)/i;
/** The sections named in reading.key_sections, matched by number (an ambiguous or missing number keeps only the note).
 * Without named sections, up to two main-text sections whose titles describe the method. */
export function keySections(notes: string[], sections: ArxivSection[]): KeySection[] {
  if (notes.length) return notes.map(note => {
    const number = sectionNumber(note);
    const found = number ? sections.filter(s => s.number?.toLowerCase() === number) : [];
    if (found.length !== 1) return { note, section: null };
    // The reason after the colon, or else whatever follows the number when it is more than the section's own title.
    const after = note.match(/[:：]\s*(.+)$/)?.[1]?.trim() ?? note.replace(NUMBER, '').trim();
    return { note: after && after.toLowerCase() !== found[0].title.toLowerCase() ? after : null, section: found[0] };
  });
  return sections.filter(s => s.text && /^\d/.test(s.number ?? '') && METHOD.test(s.title) && !NOT_METHOD.test(s.title)).slice(0, 2).map(section => ({ note: null, section }));
}
/** The link to an item in the page: the page itself, at the item's element when the page gave it an ID. */
export const sourceHref = (page: string, anchor: string | null | undefined) => anchor ? `${page}#${encodeURIComponent(anchor)}` : page;
