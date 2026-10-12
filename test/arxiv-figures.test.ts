import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheName, extractFigures, fetchArxivFigures, parseArxivId, throttled, type PageFetcher } from '../scripts/arxiv-figures';

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
    { number: 1, label: 'Figure 1', caption: 'Success rate with 4.9\\text{M} pairs & human results.', images: ['https://arxiv.org/html/2307.15644v2/intro.svg'] },
    { number: 2, label: 'Figure 2', caption: 'Overview of the pipeline. alert(1)', images: ['https://arxiv.org/html/2307.15644v2/a.png', 'https://arxiv.org/html/2307.15644v2/b.png'] },
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
  assert.deepEqual(figures, [{ number: null, label: 'Figure C.1', caption: 'Beam size.', images: ['https://arxiv.org/html/x/c1.svg'] }]);
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

