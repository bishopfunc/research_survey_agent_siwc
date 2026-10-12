/** Figures of a paper from its arXiv HTML version (design 0016). Only arXiv hosts are contacted, one page per paper,
 * at most one request every few seconds; the images themselves are loaded by the browser from arXiv. */
export const ARXIV_HOSTS = ['arxiv.org', 'ar5iv.labs.arxiv.org', 'ar5iv.org'];
const PAGES = (id: string) => [`https://arxiv.org/html/${id}`, `https://ar5iv.labs.arxiv.org/html/${id}`];
const MAX_HTML_CHARS = 20_000_000;
const MAX_FIGURES = 60;
const MAX_IMAGES = 6;
export const ARXIV_MIN_INTERVAL_MS = 3_000;

export interface ArxivFigure { number: number | null; label: string; caption: string; images: string[] }
/** Bumped when extraction changes, so results saved by an older parser are fetched again. */
export const FIGURE_PARSER_VERSION = 2;
export interface ArxivFigures { parser: number; arxiv_id: string; source_url: string; retrieved_at: string; figures: ArxivFigure[] }
export type PageFetcher = (url: string) => Promise<{ ok: boolean; status: number; url: string; headers: { get(name: string): string | null }; text(): Promise<string> }>;

const ID = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/i;
/** The arXiv identifier from Paper.arxiv_id or an arxiv.org URL, or null. */
export function parseArxivId(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const text = value?.trim(); if (!text) continue;
    const fromUrl = text.match(/^https?:\/\/(?:www\.)?(?:arxiv\.org|ar5iv(?:\.labs\.arxiv)?\.org)\/(?:abs|pdf|html)\/([^?#]+?)(?:\.pdf)?\/?(?:[?#].*)?$/i)?.[1];
    const id = (fromUrl ?? text).replace(/^arxiv:/i, '');
    if (ID.test(id)) return id;
  }
  return null;
}
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, code: string) => code[0] === '#' ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : entities[code.toLowerCase()] ?? m);
}
/** Caption HTML to plain text: math keeps its TeX alt text, every tag is dropped. Nothing from the page is ever rendered as HTML. */
function plain(html: string) {
  const withMath = html.replace(/<math\b[^>]*?\balttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi, (_, alt: string) => ` ${decode(alt)} `);
  return decode(withMath.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function attribute(tag: string, name: string) { return tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1] ?? null; }
/** Only https images under /html/ on an arXiv host survive. */
function imageUrl(src: string, page: string): string | null {
  try {
    const url = new URL(decode(src), page);
    return url.protocol === 'https:' && ARXIV_HOSTS.includes(url.hostname) && url.pathname.startsWith('/html/') ? url.href : null;
  } catch { return null; }
}

/** Top-level LaTeXML figures (not tables) with their number, caption and images. */
export function extractFigures(html: string, pageUrl: string): ArxivFigure[] {
  const figures: ArxivFigure[] = [];
  const tokens = /<figure\b[^>]*>|<\/figure>/gi;
  let depth = 0, start = -1, openTag = '';
  for (let m = tokens.exec(html); m && figures.length < MAX_FIGURES; m = tokens.exec(html)) {
    if (m[0][1] !== '/') { if (depth++ === 0) { start = m.index; openTag = m[0]; } continue; }
    if (depth === 0) continue;
    if (--depth > 0) continue;
    if (!/\bltx_figure\b/.test(attribute(openTag, 'class') ?? '')) continue;
    const segment = html.slice(start, m.index);
    const captions = [...segment.matchAll(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi)].map(c => plain(c[1]));
    const main = [...captions].reverse().find(c => /^(Figure|Fig\.?)\s*[A-Z]?\.?\d+/i.test(c)) ?? captions.at(-1) ?? '';
    // Appendix figures (Figure C.1) keep their label but have no plain number to match "Fig. N".
    const tag = main.match(/^(?:Figure|Fig\.?)\s*((?:[A-Z]\.?)?\d+(?:\.\d+)?)\s*[:.]?\s*/i);
    const images = [...segment.matchAll(/<img\b[^>]*>|<object\b[^>]*>/gi)]
      .map(t => t[0].toLowerCase().startsWith('<img') ? attribute(t[0], 'src') : (attribute(t[0], 'type') ?? '').startsWith('image/') ? attribute(t[0], 'data') : null)
      .map(src => src ? imageUrl(src, pageUrl) : null).filter((u): u is string => !!u);
    if (!images.length) continue;
    figures.push({ number: tag && /^\d+$/.test(tag[1]) ? Number(tag[1]) : null, label: tag ? `Figure ${tag[1]}` : 'Figure', caption: (tag ? main.slice(tag[0].length) : main).slice(0, 1500), images: [...new Set(images)].slice(0, MAX_IMAGES) });
  }
  return figures;
}

let last = 0;
let queue: Promise<unknown> = Promise.resolve();
/** Serializes arXiv requests with a minimum gap between them. */
export function throttled<T>(task: () => Promise<T>, wait = (ms: number) => new Promise(r => setTimeout(r, ms)), now = () => Date.now()): Promise<T> {
  const run = queue.then(async () => { const gap = last + ARXIV_MIN_INTERVAL_MS - now(); if (gap > 0) await wait(gap); last = now(); return task(); });
  queue = run.catch(() => undefined);
  return run;
}

export async function fetchArxivFigures(id: string, fetcher: PageFetcher, retrieved_at = new Date().toISOString()): Promise<ArxivFigures> {
  if (!ID.test(id)) throw Error('arXiv IDを確認してください');
  let empty: ArxivFigures | null = null;
  // arxiv.org has HTML for recent papers; ar5iv covers older ones. A page without figures falls through to the next.
  for (const page of PAGES(id)) {
    const response = await throttled(() => fetcher(page));
    if (response.status === 404) continue;
    if (!response.ok) throw Error(`arXivのページを取得できませんでした（${response.status}）`);
    const final = new URL(response.url || page);
    if (final.protocol !== 'https:' || !ARXIV_HOSTS.includes(final.hostname)) throw Error('arXiv以外へ転送されたため中止しました');
    if (!(response.headers.get('content-type') ?? '').includes('text/html')) continue;
    const html = await response.text();
    if (html.length > MAX_HTML_CHARS) throw Error('ページが大きすぎます');
    const result = { parser: FIGURE_PARSER_VERSION, arxiv_id: id, source_url: final.href, retrieved_at, figures: extractFigures(html, final.href) };
    if (result.figures.length) return result;
    empty ??= result;
  }
  return empty ?? { parser: FIGURE_PARSER_VERSION, arxiv_id: id, source_url: PAGES(id)[0], retrieved_at, figures: [] };
}
/** File name for the cache; old-style IDs contain a slash. */
export const cacheName = (id: string) => `${id.replace('/', '_')}.json`;
