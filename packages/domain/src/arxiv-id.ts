const ID = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/i;
/** The arXiv identifier from Paper.arxiv_id or an arxiv.org URL, or null. */
export function parseArxivId(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const text = value?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^10\.48550\/arxiv\./i, ''); if (!text) continue;
    const fromUrl = text.match(/^https?:\/\/(?:www\.)?(?:arxiv\.org|ar5iv(?:\.labs\.arxiv)?\.org)\/(?:abs|pdf|html)\/([^?#]+?)(?:\.pdf)?\/?(?:[?#].*)?$/i)?.[1];
    const id = (fromUrl ?? text).replace(/^arxiv:/i, '');
    if (ID.test(id)) return id;
  }
  return null;
}
