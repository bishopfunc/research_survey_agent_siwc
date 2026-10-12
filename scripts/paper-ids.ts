/** Identifiers and titles normalized for matching papers across arXiv, Semantic Scholar and OpenAlex. */
export function normalizeDoi(value: string | null | undefined): string | null {
  const doi = value?.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');
  return doi && /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}
/** arXiv registers every paper under a DataCite DOI. */
export function arxivDoi(id: string | null | undefined): string | null {
  const bare = id?.trim().replace(/^arxiv:/i, '').replace(/v\d+$/, '');
  return bare && /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/i.test(bare) ? `10.48550/arxiv.${bare.toLowerCase()}` : null;
}
/** Letters and digits only, so punctuation, case and spacing differences do not matter. */
export function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
