import test from 'node:test';
import assert from 'node:assert/strict';
import { cardFigure, labelKey } from '../apps/web/src/figure-selection';
import { hasVisuals, staleVisualCache } from '../scripts/arxiv-figures';
test('a missing, prefixed, table or ambiguous note never leaves an available card figure blank or mislabels it', () => {
  const figures = [{ label: 'Figure 1', images: ['https://arxiv.org/1.png'] }, { label: 'Figure A.1', images: ['https://arxiv.org/a.png'] }];
  assert.equal(cardFigure(figures), figures[0]); assert.equal(cardFigure(figures, 'Table 1'), figures[0]); assert.equal(cardFigure(figures, 'Figure 99'), figures[0]);
  assert.equal(cardFigure(figures, '概要: Fig. A1: overview'), figures[1]);
  assert.equal(labelKey('図 A1'), labelKey('Figure A.1')); assert.equal(labelKey('Table 1'), 'table:1');
  assert.equal(cardFigure([{ label: 'Figure 1', images: [] }]), null);
});
test('a sections-only cache expires while a successful visual cache remains reusable', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  const data = { figures: [], algorithms: [], equations: [], tables: [], sections: [{}], retrieved_at: '2026-10-10T12:00:00Z' };
  assert.equal(hasVisuals(data), false); assert.equal(staleVisualCache(data, now), true);
  assert.equal(staleVisualCache({ ...data, retrieved_at: 'invalid' }, now), true);
  assert.equal(staleVisualCache({ ...data, retrieved_at: '2026-10-12T11:00:00Z' }, now), false);
  assert.equal(staleVisualCache({ ...data, figures: [{}] }, now), false);
});

test('an arXiv DOI or a versioned URL with a fragment locates diagrams without a separate arxiv_id', async () => {
  const { parseArxivId } = await import('../packages/domain/src/arxiv-id');
  assert.equal(parseArxivId(null, 'https://doi.org/10.48550/arXiv.2211.13432'), '2211.13432');
  assert.equal(parseArxivId(null, 'https://arxiv.org/pdf/2211.13432v2.pdf#page=4'), '2211.13432v2');
  assert.equal(parseArxivId(null, '10.48550/arXiv.2211.13432'), '2211.13432');
  assert.equal(parseArxivId(null, 'https://evil.example/2211.13432'), null);
});

test('background warm-up and opening the same paper share one fetch; failure allows a retry', async () => {
  const { singleFlight } = await import('../scripts/single-flight');
  const shared = singleFlight<string, number>(); let calls = 0;
  const start = async () => { calls++; return 1; };
  const a = shared('paper', start), b = shared('paper', start);
  assert.equal(a, b); assert.deepEqual(await Promise.all([a, b]), [1, 1]); assert.equal(calls, 1);
  await shared('paper', start); assert.equal(calls, 2);
  await assert.rejects(shared('paper', async () => { throw Error('busy'); }));
  assert.equal(await shared('paper', start), 1); assert.equal(calls, 3);
});

test('successful parser-six visuals remain usable; sections-only old cache gets the new fallback', async () => {
  const { usableVisualCache } = await import('../scripts/arxiv-figures');
  const data = { parser: 6, figures: [{}], algorithms: [], equations: [], tables: [], sections: [{}] };
  assert.equal(usableVisualCache(data), true);
  assert.equal(usableVisualCache({ ...data, figures: [] }), false);
  assert.equal(usableVisualCache({ ...data, parser: 5 }), false);
  assert.equal(usableVisualCache(null), false);
});
