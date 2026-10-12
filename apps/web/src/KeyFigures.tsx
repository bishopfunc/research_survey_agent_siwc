import React, { useEffect, useRef, useState } from 'react';
import type { Entity } from '../../../packages/domain/src/index';
import { MathText, Tex } from './Tex';

type Paper = Extract<Entity, { type: 'Paper' }>;
export type ArxivFigure = { number: number | null; label: string; caption: string; images: string[] };
export type ArxivAlgorithm = { number: number | null; label: string; caption: string; lines: string[] };
export type ArxivEquation = { number: number | null; label: string | null; tex: string };
export type ArxivTable = { number: number | null; label: string; caption: string; rows: { text: string; colspan: number; rowspan: number; head: boolean }[][] };
export type ArxivFigures = { source_url: string; figures: ArxivFigure[]; algorithms?: ArxivAlgorithm[]; equations?: ArxivEquation[]; tables?: ArxivTable[] };
/** "Figure 3" / "Fig. 3" / "Table 2" / "Algorithm 1" → "figure:3", "table:2", "algorithm:1". */
export function labelKey(text: string): string | null {
  const m = text.match(/^\s*(fig(?:ure)?\.?|table|tab\.|algorithm|alg\.|図|表)\s*((?:[A-Z]\.?)?\d+(?:\.\d+)*)/i);
  if (!m) return null;
  const kind = /^(fig|図)/i.test(m[1]) ? 'figure' : /^(tab|表)/i.test(m[1]) ? 'table' : 'algorithm';
  return `${kind}:${m[2].toLowerCase()}`;
}
/** The Japanese caption Codex wrote for a label (reading.captions_ja), without the label itself. */
export function japaneseCaption(paper: Paper, label: string): string | null {
  const key = labelKey(label);
  const entry = key ? (paper.reading?.captions_ja ?? []).find(c => labelKey(c) === key) : undefined;
  return entry ? entry.replace(/^[^:：]*[:：]\s*/, '') : null;
}
export function Table({ table }: { table: ArxivTable }) {
  return <div className="arxiv-table"><table><tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => React.createElement(cell.head ? 'th' : 'td', { key: j, colSpan: cell.colspan > 1 ? cell.colspan : undefined, rowSpan: cell.rowspan > 1 ? cell.rowspan : undefined }, <MathText text={cell.text}/>))}</tr>)}</tbody></table></div>;
}

/** The arXiv identifier from the paper's field or its arxiv.org link (the server checks it again). */
export function arxivIdOf(paper: Paper): string | null {
  const fromUrl = paper.url?.match(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/([^?#]+?)(?:\.pdf)?\/?$/i)?.[1];
  return paper.arxiv_id?.replace(/^arxiv:/i, '') || fromUrl || null;
}
/** "Fig. 2.1", "Figure C.1", "図3" → "2.1", "c.1", "3"; matched against the label of each arXiv figure. */
/** "Algorithm 2" → 2, "Eq. (3)" / "式(3)" / "Equation 3" → 3. */
export const algorithmNumber = (text: string) => Number(text.match(/algorithm\s*(\d+)/i)?.[1] ?? NaN);
export const equationNumber = (text: string) => Number(text.match(/(?:eq(?:uation)?\.?|式)\s*\(?(\d+)\)?/i)?.[1] ?? NaN);
export function Algorithm({ algorithm, ja }: { algorithm: ArxivAlgorithm; ja?: string | null }) {
  return <div className="algorithm"><div className="algorithm-title"><b>{algorithm.label}</b> {ja ?? algorithm.caption}</div><ol>{algorithm.lines.map((line, i) => <li key={i}><MathText text={line}/></li>)}</ol></div>;
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
  // Figures and tables named in the reading, matched by label; an ambiguous label gets nothing rather than a wrong item.
  const figuresBy = new Map<string, ArxivFigure[]>(), tablesBy = new Map<string, ArxivTable[]>();
  for (const f of data?.figures ?? []) { const key = labelKey(f.label); if (key) figuresBy.set(key, [...(figuresBy.get(key) ?? []), f]); }
  for (const t of data?.tables ?? []) { const key = labelKey(t.label); if (key) tablesBy.set(key, [...(tablesBy.get(key) ?? []), t]); }
  const named = notes.map(note => { const key = labelKey(note); const figures = key ? figuresBy.get(key) : undefined, tables = key ? tablesBy.get(key) : undefined; return { note, figure: figures?.length === 1 ? figures[0] : undefined, table: tables?.length === 1 ? tables[0] : undefined }; });
  const used = new Set<unknown>(named.flatMap(n => [n.figure, n.table].filter(Boolean)));
  const rest = (data?.figures ?? []).filter(f => !used.has(f)), restTables = (data?.tables ?? []).filter(t => !used.has(t));
  const caption = (label: string, original: string) => { const ja = japaneseCaption(paper, label); return <>{ja ? <span className="caption-ja">{label}: {ja}</span> : null}<small>{label}: {original}</small></>; };
  const algorithms = data?.algorithms ?? [], equations = (data?.equations ?? []).filter(e => e.label);
  const unique = <T extends { number: number | null }>(list: T[], n: number) => { const found = list.filter(x => x.number === n); return found.length === 1 ? found[0] : undefined; };
  const namedFormulas = formulaNotes.map(note => ({ note, algorithm: unique(algorithms, algorithmNumber(note)), equation: unique(equations, equationNumber(note)) }));
  const usedAlgorithms = new Set(namedFormulas.flatMap(n => n.algorithm ? [n.algorithm] : [])), usedEquations = new Set(namedFormulas.flatMap(n => n.equation ? [n.equation] : []));
  const otherAlgorithms = algorithms.filter(a => !usedAlgorithms.has(a)), otherEquations = equations.filter(e => !usedEquations.has(e));
  const formulas = (formulaNotes.length > 0 || algorithms.length > 0 || equations.length > 0) && <section className="detail-section key-formulas" aria-label="アルゴリズムと数式">
    <h3>{formulaNotes.length ? '理解に重要なアルゴリズム・数式' : 'アルゴリズム・数式'}</h3>
    {namedFormulas.map(({ note, algorithm, equation }, i) => <div key={i} className="key-formula">{algorithm && <Algorithm algorithm={algorithm} ja={japaneseCaption(paper, algorithm.label)}/>}{equation && <Equation equation={equation}/>}<p>{note}</p></div>)}
    {otherAlgorithms.length > 0 && <details className="more-figures" open={!formulaNotes.length}><summary>{formulaNotes.length ? 'ほかのアルゴリズム' : 'アルゴリズム'}</summary>{otherAlgorithms.map((a, i) => <Algorithm key={i} algorithm={a} ja={japaneseCaption(paper, a.label)}/>)}</details>}
    {otherEquations.length > 0 && <details className="more-figures"><summary>{formulaNotes.length ? 'ほかの数式' : '数式'}</summary>{otherEquations.map((e, i) => <Equation key={i} equation={e}/>)}</details>}
  </section>;
  return <><section className="detail-section key-figures" aria-label={notes.length ? '理解に重要なFig' : 'Fig'}>
    <h3>{notes.length ? '理解に重要なFig' : 'Fig'}</h3>
    {named.map(({ note, figure, table }, i) => <figure key={i} className="key-figure">{figure && <Images figure={figure}/>}{table && <Table table={table}/>}<figcaption><span>{note}</span>{figure && caption(figure.label, figure.caption)}{table && caption(table.label, table.caption)}</figcaption></figure>)}
    {data && rest.length > 0 && <details className="more-figures" open={!notes.length}><summary>{notes.length ? 'ほかのFig' : 'arXivのFig'}</summary>{rest.map((figure, i) => <figure key={i} className="key-figure"><Images figure={figure}/><figcaption>{caption(figure.label, figure.caption)}</figcaption></figure>)}</details>}
    {data && restTables.length > 0 && <details className="more-figures"><summary>{notes.length ? 'ほかの表' : '表'}</summary>{restTables.map((table, i) => <figure key={i} className="key-figure"><Table table={table}/><figcaption>{caption(table.label, table.caption)}</figcaption></figure>)}</details>}
    {data && !data.figures.length && <p className="muted-label">arXivのFigなし</p>}
    {!data && id && !preview && state === 'loading' && <p className="muted-label">arXivから取得中…</p>}
    {state === 'error' && <button className="toolbar-button" onClick={() => void load()}>Figを再取得</button>}
    {data && <a className="figure-source" href={data.source_url} target="_blank" rel="noreferrer">arXiv HTML ↗</a>}
  </section>{formulas}</>;
}

/** The representative figure Codex chose (the first key figure), from the saved arXiv result only: a paper list never
 * contacts arXiv by itself. A figure cut out by hand from the PDF takes precedence and is shown by the caller. */
export function CardFigure({ paper }: { paper: Paper }) {
  const id = arxivIdOf(paper), first = paper.reading?.key_figures?.[0];
  const [figure, setFigure] = useState<ArxivFigure | null>(null);
  useEffect(() => {
    setFigure(null);
    const key = first ? figureKey(first) : null;
    if (!id || !key) return;
    let active = true;
    fetch(`/api/arxiv-figures/${encodeURIComponent(id)}`).then(r => r.ok ? r.json() : null).then((data: ArxivFigures | null) => {
      const found = (data?.figures ?? []).filter(f => figureKey(f.label) === key);
      if (active && found.length === 1) setFigure(found[0]);
    }).catch(() => { /* not fetched yet */ });
    return () => { active = false; };
  }, [id, first]);
  return figure ? <figure className="paper-figure compact"><img src={figure.images[0]} alt={`${figure.label} ${figure.caption}`} loading="lazy" referrerPolicy="no-referrer"/><figcaption>{figure.label}</figcaption></figure> : null;
}
