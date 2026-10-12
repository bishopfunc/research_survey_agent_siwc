import { useEffect, useState } from 'react';
import type { Entity } from '../../../packages/domain/src/index';

type Paper = Extract<Entity, { type: 'Paper' }>;
type ArxivFigure = { number: number | null; label: string; caption: string; images: string[] };
type ArxivFigures = { source_url: string; figures: ArxivFigure[] };

/** The arXiv identifier from the paper's field or its arxiv.org link (the server checks it again). */
export function arxivIdOf(paper: Paper): string | null {
  const fromUrl = paper.url?.match(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/([^?#]+?)(?:\.pdf)?\/?$/i)?.[1];
  return paper.arxiv_id?.replace(/^arxiv:/i, '') || fromUrl || null;
}
const figureNumber = (text: string) => Number(text.match(/(?:fig(?:ure)?\.?|図)\s*(\d+)/i)?.[1] ?? NaN);

function Images({ figure }: { figure: ArxivFigure }) {
  return <div className={figure.images.length > 1 ? 'figure-images many' : 'figure-images'}>{figure.images.map(src => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`${figure.label} ${figure.caption}`} loading="lazy" referrerPolicy="no-referrer"/></a>)}</div>;
}

/** The figures Codex named as needed to understand the paper, with their images from the arXiv HTML version when fetched. */
export function KeyFigures({ paper, preview }: { paper: Paper; preview: boolean }) {
  const id = arxivIdOf(paper);
  const notes = paper.reading?.key_figures ?? [];
  const [data, setData] = useState<ArxivFigures | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  async function load(signal?: { active: boolean }) {
    setState('loading');
    try {
      const response = await fetch(`/api/arxiv-figures/${encodeURIComponent(id!)}`, { method: 'POST' });
      const value = await response.json();
      if (!response.ok) throw Error(value.error);
      if (signal?.active !== false) { setData(value); setState('idle'); }
    } catch { if (signal?.active !== false) setState('error'); }
  }
  useEffect(() => {
    if (!id || preview) return;
    const signal = { active: true };
    // Opening a paper reads the saved result, or fetches its arXiv HTML once; the server spaces requests and keeps the result.
    fetch(`/api/arxiv-figures/${encodeURIComponent(id)}`).then(r => r.ok ? r.json() : null).then(value => { if (!signal.active) return; if (value) setData(value); else void load(signal); }).catch(() => { if (signal.active) void load(signal); });
    return () => { signal.active = false; };
  }, [id, preview]);
  if (!notes.length && !id) return null;
  const byNumber = new Map((data?.figures ?? []).filter(f => f.number !== null).map(f => [f.number as number, f]));
  const named = notes.map(note => ({ note, figure: byNumber.get(figureNumber(note)) }));
  const used = new Set(named.flatMap(n => n.figure ? [n.figure] : []));
  const rest = (data?.figures ?? []).filter(f => !used.has(f));
  return <section className="detail-section key-figures" aria-label={notes.length ? '理解に重要なFig' : 'Fig'}>
    <h3>{notes.length ? '理解に重要なFig' : 'Fig'}</h3>
    {named.map(({ note, figure }, i) => <figure key={i} className="key-figure">{figure && <Images figure={figure}/>}<figcaption><span>{note}</span>{figure && <small>{figure.label}: {figure.caption}</small>}</figcaption></figure>)}
    {data && rest.length > 0 && <details className="more-figures" open={!notes.length}><summary>{notes.length ? 'ほかのFig' : 'arXivのFig'}</summary>{rest.map((figure, i) => <figure key={i} className="key-figure"><Images figure={figure}/><figcaption><small>{figure.label}: {figure.caption}</small></figcaption></figure>)}</details>}
    {data && !data.figures.length && <p className="muted-label">arXivのFigなし</p>}
    {!data && id && !preview && state === 'loading' && <p className="muted-label">arXivから取得中…</p>}
    {state === 'error' && <button className="toolbar-button" onClick={() => void load()}>Figを再取得</button>}
    {data && <a className="figure-source" href={data.source_url} target="_blank" rel="noreferrer">arXiv HTML ↗</a>}
  </section>;
}
