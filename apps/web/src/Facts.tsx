import React from 'react';
import type { Entity, SurveySnapshot } from '../../../packages/domain/src/index';

type Evidence = Extract<Entity, { type: 'Evidence' }>;
const FACT_TYPES = ['Issue', 'Method', 'Concept', 'Keyword', 'Claim'] as const;
const FACT_LABELS: Record<(typeof FACT_TYPES)[number], string> = { Issue: '課題', Method: '手法', Concept: '系統', Keyword: 'ナレッジ', Claim: '主張' };

/** The sources of a fact (design 0025): the copied text, where it came from and where in it. */
export function Sources({ ids, snapshot, onSelect }: { ids: string[]; snapshot: SurveySnapshot; onSelect: (id: string) => void }) {
  const find = (id: string) => snapshot.entities.find(e => e.id === id);
  const sources = ids.map(find).filter((e): e is Evidence => e?.type === 'Evidence');
  if (!sources.length) return <p className="muted-label">出典なし</p>;
  return <ul className="source-list">{sources.map(s => { const origin = s.origin ? find(s.origin) : undefined; return <li key={s.id}>
    {s.excerpt ? <blockquote>{s.excerpt}</blockquote> : <p className="muted-label">原文 未取得</p>}
    <div className="source-meta">{origin && <button className="cite" onClick={() => onSelect(origin.id)}>{origin.label}</button>}<span>{s.locator}</span><a href={s.source_url} target="_blank" rel="noreferrer">開く ↗</a></div>
  </li>; })}</ul>;
}

/** The facts this paper is the source of: issues, methods, families, knowledge and claims citing Evidence that came from it. */
export function PaperFacts({ paperId, snapshot, onSelect }: { paperId: string; snapshot: SurveySnapshot; onSelect: (id: string) => void }) {
  const fromPaper = new Map(snapshot.entities.filter((e): e is Evidence => e.type === 'Evidence' && e.origin === paperId).map(e => [e.id, e]));
  const facts = snapshot.entities.flatMap(e => {
    if (!(FACT_TYPES as readonly string[]).includes(e.type)) return [];
    const cited = ((e as { evidence?: string[] }).evidence ?? []).map(id => fromPaper.get(id)).filter((x): x is Evidence => !!x);
    return cited.length ? [{ entity: e, sources: cited }] : [];
  });
  if (!facts.length) return <p className="muted-label">この論文を出典とする事実なし</p>;
  return <ul className="fact-list">{FACT_TYPES.flatMap(type => facts.filter(f => f.entity.type === type)).map(f => <li key={f.entity.id}>
    <button className="fact-name" onClick={() => onSelect(f.entity.id)}><small>{FACT_LABELS[f.entity.type as (typeof FACT_TYPES)[number]]}</small>{f.entity.label}</button>
    <span className="fact-locator">{[...new Set(f.sources.map(s => s.locator))].join(' · ')}</span>
  </li>)}</ul>;
}
