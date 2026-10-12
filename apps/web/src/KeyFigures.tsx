import React, { useEffect, useRef, useState } from 'react';
import type { Entity } from '../../../packages/domain/src/index';
import { MathText, Tex } from './Tex';
import { ALGORITHM_KEYWORD, algorithmLines } from './algorithm-layout';
import { keySections, sourceHref, type ArxivSection } from './arxiv-parts';

type Paper = Extract<Entity, { type: 'Paper' }>;
export type ArxivFigure = { number: number | null; label: string; caption: string; images: string[]; anchor?: string | null };
export type ArxivAlgorithm = { number: number | null; label: string; caption: string; lines: string[]; anchor?: string | null };
export type ArxivEquation = { number: number | null; label: string | null; tex: string; anchor?: string | null };
export type ArxivTable = { number: number | null; label: string; caption: string; rows: { text: string; colspan: number; rowspan: number; head: boolean }[][]; anchor?: string | null };
export type ArxivFigures = { source_url: string; figures: ArxivFigure[]; algorithms?: ArxivAlgorithm[]; equations?: ArxivEquation[]; tables?: ArxivTable[]; sections?: ArxivSection[] };
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
/** Text with inline math; pseudocode keywords outside math are bold. */
function Pseudocode({ text }: { text: string }) {
  return <>{text.split(/\$([^$]+)\$/).map((part, i) => i % 2 ? <Tex key={i} tex={part}/> : part.split(new RegExp(ALGORITHM_KEYWORD.source, 'g')).map((piece, j) => j % 2 ? <b key={`${i}-${j}`}>{piece}</b> : piece))}</>;
}
export function Algorithm({ algorithm, ja }: { algorithm: ArxivAlgorithm; ja?: string | null }) {
  return <div className="algorithm"><div className="algorithm-title"><b>{algorithm.label}</b> {ja ?? algorithm.caption}</div><ol>{algorithmLines(algorithm.lines).map((line, i) => <li key={i} style={{ paddingLeft: `${line.depth * 1.4}em` }}><Pseudocode text={line.text}/>{line.comment && <span className="algorithm-comment">▷ <MathText text={line.comment}/></span>}</li>)}</ol></div>;
}
export function Equation({ equation }: { equation: ArxivEquation }) {
  return <div className="equation"><Tex tex={equation.tex} display/>{equation.label && <span className="equation-label">{equation.label}</span>}</div>;
}
export const figureKey = (text: string) => text.match(/(?:fig(?:ure)?\.?|図)\s*((?:[A-Z]\.?)?\d+(?:\.\d+)*)/i)?.[1].toLowerCase().replace(/^([a-z])(\d)/, '$1.$2') ?? null;

export function Images({ figure }: { figure: ArxivFigure }) {
  return <div className={figure.images.length > 1 ? 'figure-images many' : 'figure-images'}>{figure.images.map(src => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`${figure.label} ${figure.caption}`} loading="lazy" referrerPolicy="no-referrer"/></a>)}</div>;
}

/** The paper's arXiv figures, algorithms, equations and sections: the saved result, or one fetch when the paper is opened.
 * load(true) is 最新を取得: it fetches the page again past the saved result. */
export function useArxivData(id: string | null, preview: boolean) {
  const [data, setData] = useState<ArxivFigures | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  // The ID a response belongs to; a slow answer for a previous paper is dropped.
  const current = useRef(id);
  current.current = id;
  async function load(refresh = false, signal?: { active: boolean }): Promise<boolean> {
    const requested = id;
    if (!requested) return false;
    setState('loading');
    try {
      const response = await fetch(`/api/arxiv-figures/${encodeURIComponent(requested)}${refresh ? '?refresh=1' : ''}`, { method: 'POST' });
      const value = await response.json();
      if (!response.ok) throw Error(value.error);
      if (signal?.active !== false && current.current === requested) { setData(value); setState('idle'); }
      return true;
    } catch { if (signal?.active !== false && current.current === requested) setState('error'); return false; }
  }
  useEffect(() => {
    // A changed arXiv ID (edit or saved proposal) must not keep showing the previous paper's figures.
    setData(null); setState('idle');
    if (!id) return;
    const signal = { active: true };
    // Opening a paper reads the saved result, or fetches its arXiv HTML once; the server spaces requests and keeps the result.
    // The review preview only reads saved results and never reaches arXiv.
    const fetchOnce = () => { if (signal.active && !preview) void load(false, signal); };
    fetch(`/api/arxiv-figures/${encodeURIComponent(id)}`).then(r => r.ok ? r.json() : null).then(value => { if (!signal.active) return; if (value) setData(value); else fetchOnce(); }).catch(fetchOnce);
    return () => { signal.active = false; };
  }, [id, preview]);
  return { data, state, load };
}
export type ArxivState = ReturnType<typeof useArxivData>;

/** The link to an item's place in the arXiv HTML page. */
function SourceLink({ data, anchor }: { data: ArxivFigures; anchor: string | null | undefined }) {
  return <a className="item-source" href={sourceHref(data.source_url, anchor)} target="_blank" rel="noreferrer">出典 ↗</a>;
}

/** 図解: the figures, tables, algorithms and equations Codex named as needed to understand the paper, each linked to its
 * place in the arXiv HTML version, then the others folded. An ambiguous label gets nothing rather than a wrong item. */
export function Diagrams({ paper, arxiv, preview, extra }: { paper: Paper; arxiv: ArxivState; preview: boolean; extra?: React.ReactNode }) {
  const id = arxivIdOf(paper);
  const notes = paper.reading?.key_figures ?? [], formulaNotes = paper.reading?.key_formulas ?? [];
  const { data, state } = arxiv;
  const figuresBy = new Map<string, ArxivFigure[]>(), tablesBy = new Map<string, ArxivTable[]>();
  for (const f of data?.figures ?? []) { const key = labelKey(f.label); if (key) figuresBy.set(key, [...(figuresBy.get(key) ?? []), f]); }
  for (const t of data?.tables ?? []) { const key = labelKey(t.label); if (key) tablesBy.set(key, [...(tablesBy.get(key) ?? []), t]); }
  const named = notes.map(note => { const key = labelKey(note); const figures = key ? figuresBy.get(key) : undefined, tables = key ? tablesBy.get(key) : undefined; return { note, figure: figures?.length === 1 ? figures[0] : undefined, table: tables?.length === 1 ? tables[0] : undefined }; });
  const used = new Set<unknown>(named.flatMap(n => [n.figure, n.table].filter(Boolean)));
  const algorithms = data?.algorithms ?? [], equations = (data?.equations ?? []).filter(e => e.label);
  const unique = <T extends { number: number | null }>(list: T[], n: number) => { const found = list.filter(x => x.number === n); return found.length === 1 ? found[0] : undefined; };
  const namedFormulas = formulaNotes.map(note => ({ note, algorithm: unique(algorithms, algorithmNumber(note)), equation: unique(equations, equationNumber(note)) }));
  for (const n of namedFormulas) { if (n.algorithm) used.add(n.algorithm); if (n.equation) used.add(n.equation); }
  const rest = (data?.figures ?? []).filter(f => !used.has(f)), restTables = (data?.tables ?? []).filter(t => !used.has(t));
  const otherAlgorithms = algorithms.filter(a => !used.has(a)), otherEquations = equations.filter(e => !used.has(e));
  const caption = (label: string, original: string) => { const ja = japaneseCaption(paper, label); return <>{ja ? <span className="caption-ja">{label}: {ja}</span> : null}<small>{label}: {original}</small></>; };
  const source = (anchor: string | null | undefined) => data ? <SourceLink data={data} anchor={anchor}/> : null;
  const anyNamed = !!(notes.length || formulaNotes.length);
  if (!anyNamed && !id) return extra ? <>{extra}</> : <p className="muted-label">図解なし</p>;
  return <div className="diagrams">
    {named.map(({ note, figure, table }, i) => <figure key={`f${i}`} className="key-figure">{figure && <Images figure={figure}/>}{table && <Table table={table}/>}<figcaption><span>{note}</span>{figure && caption(figure.label, figure.caption)}{table && caption(table.label, table.caption)}{(figure || table) && source((figure ?? table)!.anchor)}</figcaption></figure>)}
    {namedFormulas.map(({ note, algorithm, equation }, i) => <div key={`a${i}`} className="key-formula">{algorithm && <Algorithm algorithm={algorithm} ja={japaneseCaption(paper, algorithm.label)}/>}{equation && <Equation equation={equation}/>}<p>{note}</p>{(algorithm || equation) && source((algorithm ?? equation)!.anchor)}</div>)}
    {data && rest.length > 0 && <details className="more-figures" open={!anyNamed}><summary>{anyNamed ? 'ほかの図' : '図'}</summary>{rest.map((figure, i) => <figure key={i} className="key-figure"><Images figure={figure}/><figcaption>{caption(figure.label, figure.caption)}{source(figure.anchor)}</figcaption></figure>)}</details>}
    {data && restTables.length > 0 && <details className="more-figures"><summary>{anyNamed ? 'ほかの表' : '表'}</summary>{restTables.map((table, i) => <figure key={i} className="key-figure"><Table table={table}/><figcaption>{caption(table.label, table.caption)}{source(table.anchor)}</figcaption></figure>)}</details>}
    {data && otherAlgorithms.length > 0 && <details className="more-figures" open={!anyNamed}><summary>{anyNamed ? 'ほかのアルゴリズム' : 'アルゴリズム'}</summary>{otherAlgorithms.map((a, i) => <div key={i} className="key-formula"><Algorithm algorithm={a} ja={japaneseCaption(paper, a.label)}/>{source(a.anchor)}</div>)}</details>}
    {data && otherEquations.length > 0 && <details className="more-figures"><summary>{anyNamed ? 'ほかの数式' : '数式'}</summary>{otherEquations.map((e, i) => <div key={i} className="key-formula"><Equation equation={e}/>{source(e.anchor)}</div>)}</details>}
    {data && !data.figures.length && !data.tables?.length && !algorithms.length && !equations.length && <p className="muted-label">arXivの図解なし</p>}
    {!data && id && !preview && state === 'loading' && <p className="muted-label">arXivから取得中…</p>}
    {!data && state === 'error' && <p className="muted-label">arXivから取得できず</p>}
    {extra}
  </div>;
}

/** 重要な節: the sections named in reading.key_sections, or the sections describing the method, with the start of their
 * text and a link to their place in the arXiv HTML version. */
export function KeySections({ paper, arxiv }: { paper: Paper; arxiv: ArxivState }) {
  const { data } = arxiv;
  const items = keySections(paper.reading?.key_sections ?? [], data?.sections ?? []);
  if (!items.length) return null;
  return <><h4>重要な節</h4><div className="key-sections">{items.map((item, i) => <div key={i} className="key-section">
    {item.section ? <h5>{[item.section.number, item.section.title].filter(Boolean).join(' ')}</h5> : null}
    {item.note && <p className="key-section-note">{item.note}</p>}
    {item.section?.text && <blockquote><MathText text={item.section.text}/></blockquote>}
    {item.section && data && <SourceLink data={data} anchor={item.section.anchor}/>}
  </div>)}</div></>;
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
