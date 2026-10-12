/** Figures of a paper from its arXiv HTML version (design 0016). Only arXiv hosts are contacted, one page per paper,
 * at most one request every 15 seconds; the images themselves are loaded by the browser from arXiv. */
export const ARXIV_HOSTS = ['arxiv.org', 'ar5iv.labs.arxiv.org', 'ar5iv.org'];
const PAGES = (id: string) => [`https://arxiv.org/html/${id}`, `https://ar5iv.labs.arxiv.org/html/${id}`];
const MAX_HTML_CHARS = 20_000_000;
const MAX_FIGURES = 60;
const MAX_IMAGES = 6;
/** arxiv.org/robots.txt asks for Crawl-delay: 15. */
export const ARXIV_MIN_INTERVAL_MS = 15_000;

export interface ArxivFigure { number: number | null; label: string; caption: string; images: string[] }
/** Bumped when extraction changes, so results saved by an older parser are fetched again. */
export const FIGURE_PARSER_VERSION = 5;
/** A table float: label, caption and cells (rowspan/colspan kept), with math as $TeX$. */
export interface ArxivTable { number: number | null; label: string; caption: string; rows: { text: string; colspan: number; rowspan: number; head: boolean }[][] }
/** An algorithm float: its label, title and listing lines, with math kept as $TeX$. */
export interface ArxivAlgorithm { number: number | null; label: string; caption: string; lines: string[] }
/** A display equation row: its number label such as "(3)" and its TeX. */
export interface ArxivEquation { number: number | null; label: string | null; tex: string }
export interface ArxivFigures { parser: number; arxiv_id: string; source_url: string; retrieved_at: string; figures: ArxivFigure[]; algorithms: ArxivAlgorithm[]; equations: ArxivEquation[]; tables: ArxivTable[] }
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
/** Caption HTML to plain text: math keeps its TeX alt text, every tag is dropped. Nothing from the page is ever rendered as HTML.
 * Math is swapped for placeholders first, so a "<" in the TeX cannot be mistaken for the start of a tag. */
function plain(html: string, mathAs: (tex: string) => string = tex => tex) {
  const math: string[] = [];
  const marked = html.replace(/<math\b[^>]*?\balttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi, (_, alt: string) => ` \u0000${math.push(decode(alt)) - 1}\u0000 `);
  return decode(marked.replace(/<[^>]+>/g, ' ')).replace(/\u0000(\d+)\u0000/g, (_, n: string) => mathAs(math[Number(n)])).replace(/\s+/g, ' ').trim();
}
function attribute(tag: string, name: string) { return tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1] ?? null; }
/** Only https images under /html/ on an arXiv host survive. */
function imageUrl(src: string, page: string): string | null {
  try {
    const url = new URL(decode(src), page);
    return url.protocol === 'https:' && ARXIV_HOSTS.includes(url.hostname) && url.pathname.startsWith('/html/') ? url.href : null;
  } catch { return null; }
}

interface FigureNode { start: number; inner: number; end: number; open: string; children: FigureNode[] }
/** The nesting of <figure> elements, so side-by-side figures inside one float can be told apart from sub-panels. */
function figureTree(html: string): FigureNode[] {
  const roots: FigureNode[] = [], stack: FigureNode[] = [];
  for (const m of html.matchAll(/<figure\b[^>]*>|<\/figure>/gi)) {
    if (m[0][1] !== '/') { stack.push({ start: m.index, inner: m.index + m[0].length, end: -1, open: m[0], children: [] }); continue; }
    const node = stack.pop(); if (!node) continue;
    node.end = m.index;
    (stack.at(-1)?.children ?? roots).push(node);
  }
  return roots;
}
const LABEL = /^(?:Figure|Fig\.?)\s*((?:[A-Z]\.?)?\d+(?:\.\d+)*)\s*[:.]?\s*/i;
/** The node's own HTML, without the figures nested inside it. */
function own(html: string, node: FigureNode) {
  let out = '', at = node.inner;
  for (const child of node.children) { out += html.slice(at, child.start); at = child.end; }
  return out + html.slice(at, node.end);
}
const captions = (fragment: string) => [...fragment.matchAll(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi)].map(c => plain(c[1]));
const numbered = (list: string[]) => [...list].reverse().find(c => LABEL.test(c));

/** LaTeXML figures (not tables) with their label, caption and images. A float holding several numbered figures side by side
 * gives one entry per figure; unnumbered sub-panels (a), (b) stay with their figure. */
export function extractFigures(html: string, pageUrl: string): ArxivFigure[] {
  const figures: ArxivFigure[] = [];
  const emit = (node: FigureNode, caption: string) => {
    const segment = html.slice(node.inner, node.end);
    const images = [...segment.matchAll(/<img\b[^>]*>|<object\b[^>]*>/gi)]
      .map(t => t[0].toLowerCase().startsWith('<img') ? attribute(t[0], 'src') : (attribute(t[0], 'type') ?? '').startsWith('image/') ? attribute(t[0], 'data') : null)
      .map(src => src ? imageUrl(src, pageUrl) : null).filter((u): u is string => !!u);
    if (!images.length || figures.length >= MAX_FIGURES) return;
    // Appendix figures (Figure C.1) and sub-numbered ones (Figure 2.1) keep their full label; only a plain integer is a number.
    const tag = caption.match(LABEL);
    figures.push({ number: tag && /^\d+$/.test(tag[1]) ? Number(tag[1]) : null, label: tag ? `Figure ${tag[1]}` : 'Figure', caption: (tag ? caption.slice(tag[0].length) : caption).slice(0, 1500), images: [...new Set(images)].slice(0, MAX_IMAGES) });
  };
  for (const root of figureTree(html)) {
    if (!/\bltx_figure\b/.test(attribute(root.open, 'class') ?? '')) continue;
    const sideBySide = root.children.map(child => ({ child, caption: numbered(captions(own(html, child))) })).filter(c => c.caption);
    if (sideBySide.length >= 2) { for (const { child, caption } of sideBySide) emit(child, caption!); continue; }
    const mine = captions(own(html, root));
    emit(root, numbered(mine) ?? numbered(captions(html.slice(root.inner, root.end))) ?? mine.at(-1) ?? '');
  }
  return figures;
}

const MAX_ALGORITHMS = 20, MAX_LINES = 80, MAX_EQUATIONS = 80;
/** Algorithm floats (LaTeXML ltx_float_algorithm) with their listing lines; math inside a line stays TeX between $ signs. */
export function extractAlgorithms(html: string): ArxivAlgorithm[] {
  const out: ArxivAlgorithm[] = [];
  const visit = (nodes: FigureNode[]) => { for (const node of nodes) {
    if (!/\bltx_float_algorithm\b/.test(attribute(node.open, 'class') ?? '')) { visit(node.children); continue; }
    if (out.length >= MAX_ALGORITHMS) return;
    const segment = html.slice(node.inner, node.end);
    const caption = captions(segment)[0] ?? '';
    const tag = caption.match(/^Algorithm\s*(\d+(?:\.\d+)*)\s*[:.]?\s*/i);
    const lines = segment.split(/<div\b[^>]*\bltx_listingline\b[^>]*>/i).slice(1)
      .map(chunk => plain(chunk.replace(/<span\b[^>]*\bltx_tag_listingline\b[^>]*>[\s\S]*?<\/span>/i, ''), tex => `$${tex}$`))
      .filter(Boolean).slice(0, MAX_LINES).map(line => line.slice(0, 400));
    out.push({ number: tag && /^\d+$/.test(tag[1]) ? Number(tag[1]) : null, label: tag ? `Algorithm ${tag[1]}` : 'Algorithm', caption: (tag ? caption.slice(tag[0].length) : caption).slice(0, 300), lines });
  } };
  visit(figureTree(html));
  return out;
}
/** Display equations (LaTeXML ltx_equation / ltx_equationgroup rows), one entry per row, with the row's number label. */
export function extractEquations(html: string): ArxivEquation[] {
  const out: ArxivEquation[] = [];
  for (const table of html.matchAll(/<table\b[^>]*\bclass="[^"]*\bltx_(?:equation|equationgroup)\b[^"]*"[^>]*>([\s\S]*?)<\/table>/gi)) {
    for (const row of table[1].matchAll(/<tr\b[^>]*\bltx_eqn_row\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (out.length >= MAX_EQUATIONS) return out;
      const tex = [...row[1].matchAll(/<math\b[^>]*?\balttext="([^"]*)"[^>]*>/gi)].map(m => decode(m[1])).join(' ').trim();
      if (!tex) continue;
      const label = row[1].match(/<span\b[^>]*\bltx_tag_equation\b[^>]*>\s*\(([^)<]{1,12})\)\s*<\/span>/i)?.[1] ?? null;
      out.push({ number: label && /^\d+$/.test(label) ? Number(label) : null, label: label ? `(${label})` : null, tex: tex.slice(0, 4000) });
    }
  }
  return out;
}

const MAX_TABLES = 30, MAX_ROWS = 40, MAX_COLS = 20;
/** Table floats (LaTeXML ltx_table), each with its first tabular as rows of cells. */
export function extractTables(html: string): ArxivTable[] {
  const out: ArxivTable[] = [];
  const visit = (nodes: FigureNode[]) => { for (const node of nodes) {
    if (!/\bltx_table\b/.test(attribute(node.open, 'class') ?? '')) { visit(node.children); continue; }
    if (out.length >= MAX_TABLES) return;
    const segment = html.slice(node.inner, node.end);
    const caption = numberedTable(captions(segment)) ?? captions(segment)[0] ?? '';
    const tag = caption.match(/^Table\s*((?:[A-Z]\.?)?\d+(?:\.\d+)*)\s*[:.]?\s*/i);
    const tabular = segment.match(/<table\b[^>]*\bltx_tabular\b[^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? '';
    const rows = [...tabular.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(0, MAX_ROWS).map(tr => [...tr[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].slice(0, MAX_COLS).map(c => ({
      text: plain(c[3], tex => `$${tex}$`).slice(0, 200), colspan: Math.min(MAX_COLS, Number(attribute(c[2], 'colspan')) || 1), rowspan: Math.min(MAX_ROWS, Number(attribute(c[2], 'rowspan')) || 1), head: c[1].toLowerCase() === 'th' || /ltx_th\b/.test(attribute(c[2], 'class') ?? '') })));
    if (!rows.length) continue;
    out.push({ number: tag && /^\d+$/.test(tag[1]) ? Number(tag[1]) : null, label: tag ? `Table ${tag[1]}` : 'Table', caption: (tag ? caption.slice(tag[0].length) : caption).slice(0, 1500), rows });
  } };
  visit(figureTree(html));
  return out;
}
const numberedTable = (list: string[]) => [...list].reverse().find(c => /^Table\s*\d/i.test(c));

let last = 0;
let queue: Promise<unknown> = Promise.resolve();
/** Serializes arXiv requests with a minimum gap between them. */
export function throttled<T>(task: () => Promise<T>, wait = (ms: number) => new Promise(r => setTimeout(r, ms)), now = () => Date.now()): Promise<T> {
  const run = queue.then(async () => { const gap = last + ARXIV_MIN_INTERVAL_MS - now(); if (gap > 0) await wait(gap); last = now(); return task(); });
  queue = run.catch(() => undefined);
  return run;
}

export async function fetchArxivFigures(id: string, fetcher: PageFetcher, retrieved_at = new Date().toISOString(), schedule: <T>(task: () => Promise<T>) => Promise<T> = throttled): Promise<ArxivFigures> {
  if (!ID.test(id)) throw Error('arXiv IDを確認してください');
  let empty: ArxivFigures | null = null;
  // arxiv.org has HTML for recent papers; ar5iv covers older ones. A page without figures falls through to the next.
  for (const page of PAGES(id)) {
    const response = await schedule(() => fetcher(page));
    if (response.status === 404) continue;
    if (!response.ok) throw Error(`arXivのページを取得できませんでした（${response.status}）`);
    const final = new URL(response.url || page);
    if (final.protocol !== 'https:' || !ARXIV_HOSTS.includes(final.hostname)) throw Error('arXiv以外へ転送されたため中止しました');
    if (!(response.headers.get('content-type') ?? '').includes('text/html')) continue;
    const html = await response.text();
    if (html.length > MAX_HTML_CHARS) throw Error('ページが大きすぎます');
    const result = { parser: FIGURE_PARSER_VERSION, arxiv_id: id, source_url: final.href, retrieved_at, figures: extractFigures(html, final.href), algorithms: extractAlgorithms(html), equations: extractEquations(html), tables: extractTables(html) };
    if (result.figures.length || result.algorithms.length || result.equations.length || result.tables.length) return result;
    empty ??= result;
  }
  return empty ?? { parser: FIGURE_PARSER_VERSION, arxiv_id: id, source_url: PAGES(id)[0], retrieved_at, figures: [], algorithms: [], equations: [], tables: [] };
}
/** File name for the cache; old-style IDs contain a slash. */
export const cacheName = (id: string) => `${id.replace('/', '_')}.json`;
