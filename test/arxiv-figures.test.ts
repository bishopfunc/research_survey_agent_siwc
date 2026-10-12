import test from 'node:test';
import assert from 'node:assert/strict';
import { keySections, sectionNumber, sourceHref } from '../apps/web/src/arxiv-parts';
import { ARXIV_MIN_INTERVAL_MS, cacheName, extractAlgorithms, extractEquations, extractSections, extractTables, extractFigures, fetchArxivFigures, parseArxivId, throttled, type PageFetcher } from '../scripts/arxiv-figures';

const page = 'https://arxiv.org/html/2307.15644';
const html = `<html><body>
<figure id="S1.F1" class="ltx_figure"><object type="image/svg+xml" data="2307.15644v2/intro.svg"></object>
<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">Figure 1: </span>Success rate with <math alttext="4.9\\text{M}" display="inline"><mi>4.9</mi></math> pairs &amp; human results.</figcaption></figure>
<figure id="S3.F2" class="ltx_figure">
  <figure class="ltx_figure ltx_figure_panel"><img src="2307.15644v2/a.png" class="ltx_graphics"><figcaption><span class="ltx_tag">(a)</span> left</figcaption></figure>
  <figure class="ltx_figure ltx_figure_panel"><img src="https://evil.example/b.png"><img src="javascript:alert(1)"><img src="/html/2307.15644v2/b.png"></figure>
  <figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">Figure 2: </span>Overview <b>of</b> the pipeline.<script>alert(1)</script></figcaption>
</figure>
<figure id="S4.T1" class="ltx_table"><img src="2307.15644v2/table.png"><figcaption>Table 1: results</figcaption></figure>
<figure id="S5.F3" class="ltx_figure"><figcaption>Figure 3: a figure whose image is missing</figcaption></figure>
</body></html>`;

test('top-level figures keep their number, plain-text caption and arXiv images; tables, panels and foreign images are left out', () => {
  assert.deepEqual(extractFigures(html, page), [
    { number: 1, label: 'Figure 1', caption: 'Success rate with 4.9\\text{M} pairs & human results.', images: ['https://arxiv.org/html/2307.15644v2/intro.svg'], anchor: 'S1.F1' },
    { number: 2, label: 'Figure 2', caption: 'Overview of the pipeline. alert(1)', images: ['https://arxiv.org/html/2307.15644v2/a.png', 'https://arxiv.org/html/2307.15644v2/b.png'], anchor: 'S3.F2' },
  ]);
});
test('arXiv IDs come from the field or an arxiv.org link; anything else is refused', () => {
  assert.equal(parseArxivId('2307.15644v2'), '2307.15644v2');
  assert.equal(parseArxivId(null, 'https://arxiv.org/abs/2307.15644'), '2307.15644');
  assert.equal(parseArxivId(null, 'https://arxiv.org/pdf/2307.15644v1.pdf'), '2307.15644v1');
  assert.equal(parseArxivId('arXiv:cs/0112017'), 'cs/0112017');
  assert.equal(parseArxivId('../../etc/passwd', 'https://example.org/abs/2307.15644'), null);
  assert.equal(cacheName('cs/0112017'), 'cs_0112017.json');
});
function pages(map: Record<string, { status: number; url?: string; type?: string; body?: string }>) {
  const seen: string[] = [];
  const fetcher: PageFetcher = async url => { seen.push(url); const p = map[url] ?? { status: 404 }; return { ok: p.status === 200, status: p.status, url: p.url ?? url, headers: { get: () => p.type ?? 'text/html; charset=utf-8' }, text: async () => p.body ?? '' }; };
  return { fetcher, seen };
}
test('a page without figures falls through to ar5iv; redirects off arXiv and bad IDs are refused', async () => {
  const fallback = pages({ 'https://arxiv.org/html/2101.00001': { status: 200, body: '<p>HTML is not available</p>' }, 'https://ar5iv.labs.arxiv.org/html/2101.00001': { status: 200, body: html.replaceAll('2307.15644v2/', 'x/') } });
  const now = <T,>(task: () => Promise<T>) => task();
  const out = await fetchArxivFigures('2101.00001', fallback.fetcher, '2026-10-12T00:00:00Z', now);
  assert.equal(out.source_url, 'https://ar5iv.labs.arxiv.org/html/2101.00001');
  assert.equal(out.figures[0].images[0], 'https://ar5iv.labs.arxiv.org/html/x/intro.svg');
  assert.deepEqual(fallback.seen, ['https://arxiv.org/html/2101.00001', 'https://ar5iv.labs.arxiv.org/html/2101.00001']);
  const redirected = pages({ 'https://arxiv.org/html/2101.00002': { status: 200, url: 'https://evil.example/html/2101.00002', body: html } });
  await assert.rejects(fetchArxivFigures('2101.00002', redirected.fetcher, 't', now), /arXiv以外/);
  await assert.rejects(fetchArxivFigures('../x', redirected.fetcher, 't', now), /arXiv ID/);
  const none = pages({});
  assert.deepEqual((await fetchArxivFigures('2101.00003', none.fetcher, 't', now)).figures, []);
});
test('a busy arXiv (429, 5xx, a thrown timeout) is retried, waiting for Retry-After; a lasting failure still fails', async () => {
  const now = <T,>(task: () => Promise<T>) => task();
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };
  let calls = 0;
  const flaky: PageFetcher = async url => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, url, headers: { get: (h: string) => h.toLowerCase() === 'retry-after' ? '20' : null }, text: async () => '' };
    if (calls === 2) throw Error('timeout');
    return { ok: true, status: 200, url, headers: { get: () => 'text/html' }, text: async () => html };
  };
  const out = await fetchArxivFigures('2307.15644', flaky, 't', now, wait);
  assert.ok(out.figures.length > 0);
  assert.deepEqual(waits, [20000]);
  const down: PageFetcher = async url => ({ ok: false, status: 503, url, headers: { get: () => null }, text: async () => '' });
  await assert.rejects(fetchArxivFigures('2307.15644', down, 't', now, wait), /503/);
});
test('arXiv requests are serialized with a minimum gap', async () => {
  let clock = Date.now() + 60_000; const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); clock += ms; };
  const order: string[] = [];
  await Promise.all(['a', 'b', 'c'].map(name => throttled(async () => { order.push(name); }, wait, () => clock)));
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.ok(waits.length >= 2 && waits.every(ms => ms > 0 && ms <= 15_000));
});
test('appendix figures keep their label without a number that could match a main-text figure', () => {
  const figures = extractFigures('<figure class="ltx_figure"><img src="x/c1.svg"><figcaption><span class="ltx_tag ltx_tag_figure">Figure C.1: </span>Beam size.</figcaption></figure>', page);
  assert.deepEqual(figures, [{ number: null, label: 'Figure C.1', caption: 'Beam size.', images: ['https://arxiv.org/html/x/c1.svg'], anchor: null }]);
});
test('a "<" inside math does not swallow the caption text after it', () => {
  const [figure] = extractFigures('<figure class="ltx_figure"><img src="x/a.png"><figcaption>Figure 5: Success rate when <math alttext="\\epsilon&lt;0.1"><mi>ε</mi></math> compared with HAMT <cite>[9]</cite>. Higher is better.</figcaption></figure>', page);
  assert.equal(figure.caption, 'Success rate when \\epsilon<0.1 compared with HAMT [9] . Higher is better.');
});
test('side-by-side figures in one float become separate figures; sub-numbered labels are kept whole', () => {
  const twin = `<figure class="ltx_figure">
    <figure class="ltx_figure ltx_minipage"><img src="x/x3.png"><figcaption>Figure 3: Left.</figcaption></figure>
    <figure class="ltx_figure ltx_minipage"><img src="x/x4.png"><figcaption>Figure 4: Right.</figcaption></figure></figure>
  <figure class="ltx_figure"><figure class="ltx_figure_panel"><img src="x/a.png"><figcaption>(a)</figcaption></figure><figure class="ltx_figure_panel"><img src="x/b.png"><figcaption>(b)</figcaption></figure><figcaption>Figure 5: Two panels.</figcaption></figure>
  <figure class="ltx_figure"><img src="x/s1.png"><figcaption>Figure 2.1: Sub-numbered.</figcaption></figure>`;
  assert.deepEqual(extractFigures(twin, page).map(f => [f.label, f.number, f.caption, f.images.length]), [['Figure 3', 3, 'Left.', 1], ['Figure 4', 4, 'Right.', 1], ['Figure 5', 5, 'Two panels.', 2], ['Figure 2.1', null, 'Sub-numbered.', 1]]);
});
test('algorithm floats keep their label, title and listing lines with inline math as TeX', () => {
  const html = `<figure id="alg1" class="ltx_float ltx_float_algorithm ltx_framed"><figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_float"><span class="ltx_text ltx_font_bold">Algorithm 1</span> </span> LaCAM</figcaption>
    <div class="ltx_listing"><div class="ltx_listingline"><span class="ltx_tag ltx_tag_listingline">1:</span></div>
    <div class="ltx_listingline"><span class="ltx_tag ltx_tag_listingline">2:</span>initialize <math alttext="\\mathit{Open}"><mi>O</mi></math> &amp; push</div>
    <div class="ltx_listingline"><span class="ltx_tag ltx_tag_listingline">3:</span><b>while</b> <math alttext="x&lt;y"><mi>x</mi></math> <b>do</b></div></div></figure>
  <figure class="ltx_figure"><img src="x/a.png"><figcaption>Figure 1: not an algorithm</figcaption></figure>`;
  assert.deepEqual(extractAlgorithms(html), [{ number: 1, label: 'Algorithm 1', caption: 'LaCAM', lines: ['initialize $\\mathit{Open}$ & push', 'while $x<y$ do'], anchor: 'alg1' }]);
});
test('display equations give one entry per row with its number label; inline math is not an equation', () => {
  const html = `<p>inline <math alttext="a" display="inline"></math></p>
  <table id="S3.E1" class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell"><math alttext="\\argmax_{r} P(r)" display="block"></math></td><td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation ltx_align_right">(1)</span></td></tr></tbody></table>
  <table class="ltx_equationgroup ltx_eqn_table"><tbody><tr class="ltx_eqn_row"><td><math alttext="L" display="block"></math></td><td><math alttext="=a+b" display="block"></math></td><td><span class="ltx_tag ltx_tag_equation">(2a)</span></td></tr><tr class="ltx_eqn_row"><td><math alttext="M=c" display="block"></math></td></tr></tbody></table>`;
  assert.deepEqual(extractEquations(html), [{ number: 1, label: '(1)', tex: '\\argmax_{r} P(r)', anchor: 'S3.E1' }, { number: null, label: '(2a)', tex: 'L =a+b', anchor: null }, { number: null, label: null, tex: 'M=c', anchor: null }]);
});
test('arXiv requests keep the robots.txt crawl delay', () => { assert.equal(ARXIV_MIN_INTERVAL_MS, 15_000); });
test('table floats keep their label, caption and cells with spans and math', () => {
  const html = `<figure id="S4.T1" class="ltx_table"><figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 1: </span>Comparison on R2R.</figcaption>
    <table class="ltx_tabular"><tr class="ltx_tr"><td class="ltx_td" rowspan="2">Methods</td><td class="ltx_td" colspan="2">Val-Unseen</td></tr>
    <tr class="ltx_tr"><th class="ltx_th">SR<math alttext="\\uparrow"></math></th><td class="ltx_td">SPL</td></tr><tr><td>Ours</td><td>72.9</td><td>62.8</td></tr></table></figure>
  <figure class="ltx_figure"><img src="x/a.png"><figcaption>Figure 1: not a table</figcaption></figure>`;
  assert.deepEqual(extractTables(html), [{ number: 1, label: 'Table 1', caption: 'Comparison on R2R.', rows: [
    [{ text: 'Methods', colspan: 1, rowspan: 2, head: false }, { text: 'Val-Unseen', colspan: 2, rowspan: 1, head: false }],
    [{ text: 'SR $\\uparrow$', colspan: 1, rowspan: 1, head: true }, { text: 'SPL', colspan: 1, rowspan: 1, head: false }],
    [{ text: 'Ours', colspan: 1, rowspan: 1, head: false }, { text: '72.9', colspan: 1, rowspan: 1, head: false }, { text: '62.8', colspan: 1, rowspan: 1, head: false }],
  ], anchor: 'S4.T1' }]);
});
test('sections keep their number, title, anchor and own paragraphs; the bibliography and acknowledgements are left out', () => {
  const html = `<section id="S3" class="ltx_section"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">3 </span>Algorithm</h2>
    <div class="ltx_para"><p class="ltx_p">LaCAM is a two-level search over <math alttext="G=(V,E)"></math> ( Stern et al. 2019 ) .</p></div>
    <section id="S3.SS0.Px1" class="ltx_paragraph"><h4 class="ltx_title">Low-level</h4><div class="ltx_para"><p class="ltx_p">Constraints are added lazily.</p></div></section>
    <section id="S3.SS1" class="ltx_subsection"><h3 class="ltx_title ltx_title_subsection"><span class="ltx_tag ltx_tag_subsection">3.1 </span>Pseudocode<script>x</script></h3><div class="ltx_para"><p class="ltx_p">${'word '.repeat(400)}</p></div></section></section>
  <section id="A1" class="ltx_appendix"><h2 class="ltx_title"><span class="ltx_tag ltx_tag_appendix">Appendix A </span>Proofs</h2><div class="ltx_para"><p class="ltx_p">Lemma.</p></div></section>
  <section id="Sx1" class="ltx_section"><h2 class="ltx_title">Acknowledgments</h2><div class="ltx_para"><p class="ltx_p">Thanks.</p></div></section>
  <section id="bib" class="ltx_bibliography"><h2 class="ltx_title">References</h2></section>`;
  const sections = extractSections(html);
  assert.deepEqual(sections.map(s => [s.number, s.title, s.anchor]), [['3', 'Algorithm', 'S3'], ['3.1', 'Pseudocode x', 'S3.SS1'], ['A', 'Proofs', 'A1']]);
  assert.equal(sections[0].text, 'LaCAM is a two-level search over $G=(V,E)$ (Stern et al. 2019). Constraints are added lazily.');
  assert.ok(sections[1].text.length <= 1201 && sections[1].text.endsWith('…'));
  // A cut never ends inside math, and citation spacing is tidied outside math only.
  const long = `<section id="S5" class="ltx_section"><h2 class="ltx_title"><span class="ltx_tag">5 </span>Proof</h2><div class="ltx_para"><p class="ltx_p">${'word '.repeat(238)}see <math alttext="f( x , y ) = ( a )"></math> and more</p></div></section>`;
  const [proof] = extractSections(long);
  assert.equal((proof.text.match(/\$/g)?.length ?? 0) % 2, 0);
  assert.equal(extractSections(long.replace('word '.repeat(238), 'cite ( Li 2020 ) . ')).at(0)!.text, 'cite (Li 2020). see $f( x , y ) = ( a )$ and more');
});

test('key sections match the numbers named in the reading, or fall back to the sections describing the method', () => {
  const sections = [
    { number: '1', title: 'Introduction', anchor: 'S1', text: 'intro' },
    { number: '3', title: 'Algorithm', anchor: 'S3', text: 'two-level search' },
    { number: '3.1', title: 'Concept', anchor: 'S3.SS1', text: 'concept' },
    { number: '3.2', title: 'Pseudocode', anchor: 'S3.SS2', text: 'listing' },
    { number: '4', title: 'Evaluation', anchor: 'S4', text: 'results' },
    { number: 'A', title: 'Proposed proofs', anchor: 'A1', text: 'lemma' },
  ];
  assert.deepEqual([sectionNumber('3.2 Pseudocode: why'), sectionNumber('Section 4'), sectionNumber('§A: proofs'), sectionNumber('Pseudocode'), sectionNumber('Appendix A: lemma'), sectionNumber('Sec 3.1'), sectionNumber('第3節：手法')], ['3.2', '4', 'a', null, 'a', '3.1', '3']);
  assert.deepEqual(keySections(['3.2 shows the search loop', '3.1 Concept'], sections).map(k => k.note), ['shows the search loop', null]);
  assert.deepEqual(keySections(['3.2 Pseudocode: 探索の流れ', 'Section 9: 無い節'], sections), [{ note: '探索の流れ', section: sections[3] }, { note: 'Section 9: 無い節', section: null }]);
  assert.deepEqual(keySections([], sections).map(k => k.section?.anchor), ['S3', 'S3.SS1']);
  assert.equal(sourceHref('https://arxiv.org/html/2211.13432', 'S3.SS2'), 'https://arxiv.org/html/2211.13432#S3.SS2');
  assert.equal(sourceHref('https://arxiv.org/html/2211.13432', null), 'https://arxiv.org/html/2211.13432');
});
