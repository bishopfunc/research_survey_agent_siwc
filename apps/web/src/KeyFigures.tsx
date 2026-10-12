import { useEffect, useRef, useState } from 'react';
import type { Entity } from '../../../packages/domain/src/index';
import { MathText, Tex } from './Tex';

type Paper = Extract<Entity, { type: 'Paper' }>;
export type ArxivFigure = { number: number | null; label: string; caption: string; images: string[] };
export type ArxivAlgorithm = { number: number | null; label: string; caption: string; lines: string[] };
export type ArxivEquation = { number: number | null; label: string | null; tex: string };
export type ArxivFigures = { source_url: string; figures: ArxivFigure[]; algorithms?: ArxivAlgorithm[]; equations?: ArxivEquation[] };

/** The arXiv identifier from the paper's field or its arxiv.org link (the server checks it again). */
export function arxivIdOf(paper: Paper): string | null {
  const fromUrl = paper.url?.match(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/([^?#]+?)(?:\.pdf)?\/?$/i)?.[1];
  return paper.arxiv_id?.replace(/^arxiv:/i, '') || fromUrl || null;
}
/** "Fig. 2.1", "Figure C.1", "図3" → "2.1", "c.1", "3"; matched against the label of each arXiv figure. */
/** "Algorithm 2" → 2, "Eq. (3)" / "式(3)" / "Equation 3" → 3. */
export const algorithmNumber = (text: string) => Number(text.match(/algorithm\s*(\d+)/i)?.[1] ?? NaN);
export const equationNumber = (text: string) => Number(text.match(/(?:eq(?:uation)?\.?|式)\s*\(?(\d+)\)?/i)?.[1] ?? NaN);
export function Algorithm({ algorithm }: { algorithm: ArxivAlgorithm }) {
  return <div className="algorithm"><div className="algorithm-title"><b>{algorithm.label}</b> {algorithm.caption}</div><ol>{algorithm.lines.map((line, i) => <li key={i}><MathText text={line}/></li>)}</ol></div>;
}
export function Equation({ equation }: { equation: ArxivEquation }) {
  return <div className="equation"><Tex tex={equation.tex} display/>{equation.label && <span className="equation-label">{equation.label}</span>}</div>;
}
export const figureKey = (text: string) => text.match(/(?:fig(?:ure)?\.?|図)\s*((?:[A-Z]\.?)?\d+(?:\.\d+)*)/i)?.[1].toLowerCase().replace(/^([a-z])(\d)/, '$1.$2') ?? null;

export function Images({ figure }: { figure: ArxivFigure }) {
  return <div className={figure.images.length > 1 ? 'figure-images many' : 'figure-images'}>{figure.images.map(src => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`${figure.label} ${figure.caption}`} loading="lazy" referrerPolicy="no-referrer"/></a>)}</div>;
}

/** The paper's arXiv figures, algorithms and equations: the saved result, or one fetch when the paper is opened. */
export function useArxivData(id: string | null, preview: boolean) {
  const [data, setData] = useState<ArxivFigures | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  // The ID a response belongs to; a slow answer for a previous paper is dropped.
  const current = useRef(id);
  current.current = id;
  async function load(signal?: { active: boolean }) {
    const requested = id;
    setState('loading');
    try {
      const response = await fetch(`/api/arxiv-figures/${encodeURIComponent(requested!)}`, { method: 'POST' });
      const value = await response.json();
      if (!response.ok) throw Error(value.error);
      if (signal?.active !== false && current.current === requested) { setData(value); setState('idle'); }
    } catch { if (signal?.active !== false && current.current === requested) setState('error'); }
  }
  useEffect(() => {
    // A changed arXiv ID (edit or saved proposal) must not keep showing the previous paper's figures.
    setData(null); setState('idle');
    if (!id || preview) return;
    const signal = { active: true };
    // Opening a paper reads the saved result, or fetches its arXiv HTML once; the server spaces requests and keeps the result.
    fetch(`/api/arxiv-figures/${encodeURIComponent(id)}`).then(r => r.ok ? r.json() : null).then(value => { if (!signal.active) return; if (value) setData(value); else void load(signal); }).catch(() => { if (signal.active) void load(signal); });
    return () => { signal.active = false; };
  }, [id, preview]);
  return { data, state, load };
}

/** The figures Codex named as needed to understand the paper, with their images from the arXiv HTML version when fetched. */
export function KeyFigures({ paper, preview }: { paper: Paper; preview: boolean }) {
  const id = arxivIdOf(paper);
  const notes = paper.reading?.key_figures ?? [];
  const formulaNotes = paper.reading?.key_formulas ?? [];
  const { data, state, load } = useArxivData(id, preview);
  if (!notes.length && !id) return null;
  const byKey = new Map<string, ArxivFigure[]>();
  for (const f of data?.figures ?? []) { const key = figureKey(f.label); if (key) byKey.set(key, [...(byKey.get(key) ?? []), f]); }
  // An ambiguous label (two figures with the same number) gets no image rather than a wrong one.
  const named = notes.map(note => { const key = figureKey(note); const found = key ? byKey.get(key) : undefined; return { note, figure: found?.length === 1 ? found[0] : undefined }; });
  const used = new Set(named.flatMap(n => n.figure ? [n.figure] : []));
  const rest = (data?.figures ?? []).filter(f => !used.has(f));
  const algorithms = data?.algorithms ?? [], equations = (data?.equations ?? []).filter(e => e.label);
  const unique = <T extends { number: number | null }>(list: T[], n: number) => { const found = list.filter(x => x.number === n); return found.length === 1 ? found[0] : undefined; };
  const namedFormulas = formulaNotes.map(note => ({ note, algorithm: unique(algorithms, algorithmNumber(note)), equation: unique(equations, equationNumber(note)) }));
  const usedAlgorithms = new Set(namedFormulas.flatMap(n => n.algorithm ? [n.algorithm] : [])), usedEquations = new Set(namedFormulas.flatMap(n => n.equation ? [n.equation] : []));
  const otherAlgorithms = algorithms.filter(a => !usedAlgorithms.has(a)), otherEquations = equations.filter(e => !usedEquations.has(e));
  const formulas = (formulaNotes.length > 0 || algorithms.length > 0 || equations.length > 0) && <section className="detail-section key-formulas" aria-label="アルゴリズムと数式">
    <h3>{formulaNotes.length ? '理解に重要なアルゴリズム・数式' : 'アルゴリズム・数式'}</h3>
    {namedFormulas.map(({ note, algorithm, equation }, i) => <div key={i} className="key-formula">{algorithm && <Algorithm algorithm={algorithm}/>}{equation && <Equation equation={equation}/>}<p>{note}</p></div>)}
    {otherAlgorithms.length > 0 && <details className="more-figures" open={!formulaNotes.length}><summary>{formulaNotes.length ? 'ほかのアルゴリズム' : 'アルゴリズム'}</summary>{otherAlgorithms.map((a, i) => <Algorithm key={i} algorithm={a}/>)}</details>}
    {otherEquations.length > 0 && <details className="more-figures"><summary>{formulaNotes.length ? 'ほかの数式' : '数式'}</summary>{otherEquations.map((e, i) => <Equation key={i} equation={e}/>)}</details>}
  </section>;
  return <><section className="detail-section key-figures" aria-label={notes.length ? '理解に重要なFig' : 'Fig'}>
    <h3>{notes.length ? '理解に重要なFig' : 'Fig'}</h3>
    {named.map(({ note, figure }, i) => <figure key={i} className="key-figure">{figure && <Images figure={figure}/>}<figcaption><span>{note}</span>{figure && <small>{figure.label}: {figure.caption}</small>}</figcaption></figure>)}
    {data && rest.length > 0 && <details className="more-figures" open={!notes.length}><summary>{notes.length ? 'ほかのFig' : 'arXivのFig'}</summary>{rest.map((figure, i) => <figure key={i} className="key-figure"><Images figure={figure}/><figcaption><small>{figure.label}: {figure.caption}</small></figcaption></figure>)}</details>}
    {data && !data.figures.length && <p className="muted-label">arXivのFigなし</p>}
    {!data && id && !preview && state === 'loading' && <p className="muted-label">arXivから取得中…</p>}
    {state === 'error' && <button className="toolbar-button" onClick={() => void load()}>Figを再取得</button>}
    {data && <a className="figure-source" href={data.source_url} target="_blank" rel="noreferrer">arXiv HTML ↗</a>}
  </section>{formulas}</>;
}
