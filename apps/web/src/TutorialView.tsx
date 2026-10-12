import React from 'react';
import type { Entity, SurveySnapshot } from '../../../packages/domain/src/index';
import { tutorialOutline } from '../../../packages/domain/src/tutorial';
import { Algorithm, Equation, Images, algorithmNumber, arxivIdOf, equationNumber, figureKey, japaneseCaption, useArxivData } from './KeyFigures';
import { MathText, Tex } from './Tex';

type Paper = Extract<Entity, { type: 'Paper' }>;
type Tutorial = Extract<Entity, { type: 'Tutorial' }>;
type Section = Tutorial['sections'][number];

/** "Sharon+ AIJ 2015" style short citation; other entities show their label. */
function citeLabel(entity: Entity | undefined, id: string) {
  if (!entity) return id;
  if (entity.type !== 'Paper') return entity.label;
  const surname = entity.authors[0]?.split(/\s+/).at(-1);
  return [surname ? `${surname}${entity.authors.length > 1 ? '+' : ''}` : entity.label, entity.venue, entity.year].filter(Boolean).join(' ');
}
/** Inline text: [@ID] citations become buttons, $…$ math is rendered. */
function Inline({ text, find, onSelect }: { text: string; find: (id: string) => Entity | undefined; onSelect: (id: string) => void }) {
  return <>{text.split(/(\[@[^\]\s]+\])/).map((part, i) => {
    const id = part.match(/^\[@([^\]\s]+)\]$/)?.[1];
    return id ? <button key={i} className="cite" data-entity-id={id} onClick={() => onSelect(id)}>{citeLabel(find(id), id)}</button> : <MathText key={i} text={part}/>;
  })}</>;
}
/** Paragraphs separated by blank lines; "- " lines form a list; a $$…$$ paragraph is a display equation. */
function Body({ body, find, onSelect }: { body: string; find: (id: string) => Entity | undefined; onSelect: (id: string) => void }) {
  return <>{body.split(/\n\s*\n/).map((block, i) => {
    const text = block.trim();
    const heading = text.match(/^#{3,6}\s+(.+)$/);
    if (heading && !text.includes('\n')) return <h5 key={i}><Inline text={heading[1]} find={find} onSelect={onSelect}/></h5>;
    const display = text.match(/^\$\$([\s\S]+)\$\$$/);
    if (display) return <div key={i} className="equation tutorial-equation"><Tex tex={display[1].trim()} display/></div>;
    const lines = text.split('\n');
    const item = (l: string) => /^\s*[-・]\s+/.test(l);
    const list = (items: string[]) => <ul key={`${i}-list`}>{items.map((l, j) => <li key={j}><Inline text={l.replace(/^\s*[-・]\s+/, '')} find={find} onSelect={onSelect}/></li>)}</ul>;
    if (lines.every(item)) return list(lines);
    // A lead line followed by a list ("未解決の問い：" then "- …？") is a paragraph and a list.
    if (lines.length > 1 && !item(lines[0]) && lines.slice(1).every(item)) return <React.Fragment key={i}><p><Inline text={lines[0]} find={find} onSelect={onSelect}/></p>{list(lines.slice(1))}</React.Fragment>;
    return <p key={i}><Inline text={text} find={find} onSelect={onSelect}/></p>;
  })}</>;
}
/** A figure, algorithm or equation of a cited paper, looked up in its arXiv HTML version by label. */
function Media({ paper, label, captionJa, preview, onSelect }: { paper: Paper | undefined; label: string; captionJa?: string; preview: boolean; onSelect: (id: string) => void }) {
  // The tutorial's own Japanese caption first, then the paper's translated caption; the English original only as a last resort.
  const ja = (key: string) => captionJa ?? (paper ? japaneseCaption(paper, key) : null);
  const { data, state } = useArxivData(paper ? arxivIdOf(paper) : null, preview);
  const figure = (() => { const key = figureKey(label); const found = key ? (data?.figures ?? []).filter(f => figureKey(f.label) === key) : []; return found.length === 1 ? found[0] : undefined; })();
  const algorithm = /algorithm/i.test(label) ? (data?.algorithms ?? []).filter(a => a.number === algorithmNumber(label)) : [];
  const equation = /eq|式/i.test(label) ? (data?.equations ?? []).filter(e => e.number === equationNumber(label)) : [];
  const source = paper ? <button className="cite" onClick={() => onSelect(paper.id)}>{citeLabel(paper, paper.id)}</button> : null;
  return <figure className="tutorial-media">
    {figure && <Images figure={figure}/>}{algorithm.length === 1 && <Algorithm algorithm={algorithm[0]} ja={ja(algorithm[0].label)}/>}{equation.length === 1 && <Equation equation={equation[0]}/>}
    <figcaption>{algorithm.length === 1 ? null : <>{label}{figure ? `: ${ja(figure.label) ?? figure.caption}` : captionJa && `: ${captionJa}`}</>}{source && <>{algorithm.length === 1 ? '' : ' · '}{source}</>}{!data && state === 'loading' && <span className="muted-label"> arXivから取得中…</span>}</figcaption>
  </figure>;
}

export function TutorialView({ snapshot, preview, onSelect }: { snapshot: SurveySnapshot; preview: boolean; onSelect: (id: string) => void }) {
  const tutorial = snapshot.entities.find((e): e is Tutorial => e.type === 'Tutorial');
  if (!tutorial?.sections.length) return <div className="empty">チュートリアル未作成</div>;
  const find = (id: string) => snapshot.entities.find(e => e.id === id);
  const anchor = (i: number) => `tutorial-${i}`;
  const cited = (section: Section) => new Set([...section.body.matchAll(/\[@([^\]\s]+)\]/g)].map(m => m[1]));
  const go = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const outline = tutorialOutline(tutorial.sections);
  const content = (section: Section) => {
    const extra = section.refs.filter(id => !cited(section).has(id));
    return <>
      <Body body={section.body} find={find} onSelect={onSelect}/>
      {section.media.map((m, j) => { const paper = find(m.paper); return <Media key={`${m.paper}-${m.label}-${j}`} paper={paper?.type === 'Paper' ? paper : undefined} label={m.label} captionJa={m.caption_ja} preview={preview} onSelect={onSelect}/>; })}
      {section.links.length > 0 && <ul className="tutorial-links">{section.links.map((l, j) => <li key={j}><a href={l.url} target="_blank" rel="noreferrer">{l.title} ↗</a></li>)}</ul>}
      {extra.length > 0 && <p className="tutorial-refs">{extra.map(id => <button key={id} className="cite" data-entity-id={id} onClick={() => onSelect(id)}>{citeLabel(find(id), id)}</button>)}</p>}
    </>;
  };
  return <article className="tutorial">
    <h2>{tutorial.label}</h2>
    {tutorial.summary?.trim() && <p className="tutorial-summary">{tutorial.summary}</p>}
    <nav className="tutorial-toc" aria-label="目次"><ol>{outline.map(chapter => <li key={chapter.number}>
      <a href={`#${anchor(chapter.sections[0].index)}`} onClick={go(anchor(chapter.sections[0].index))}><span className="toc-number">{chapter.number}</span>{chapter.title}</a>
      {chapter.sections.length > 1 && <ol>{chapter.sections.map(s => <li key={s.index}><a href={`#${anchor(s.index)}`} onClick={go(anchor(s.index))}><span className="toc-number">{s.number}</span>{s.heading}</a></li>)}</ol>}
    </li>)}</ol></nav>
    {outline.map(chapter => chapter.sections.length > 1
      ? <section key={chapter.number} className="tutorial-chapter"><h3 id={anchor(chapter.sections[0].index)}><span className="heading-number">{chapter.number}</span>{chapter.title}</h3>
        {chapter.sections.map(s => <section key={s.index} id={s.index === chapter.sections[0].index ? undefined : anchor(s.index)} className="tutorial-section"><h4><span className="heading-number">{s.number}</span>{s.heading}</h4>{content(tutorial.sections[s.index])}</section>)}</section>
      : <section key={chapter.number} id={anchor(chapter.sections[0].index)} className="tutorial-section"><h3><span className="heading-number">{chapter.number}</span>{chapter.title}</h3>{content(tutorial.sections[chapter.sections[0].index])}</section>)}
  </article>;
}
