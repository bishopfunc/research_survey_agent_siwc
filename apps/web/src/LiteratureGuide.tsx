import React, { useState } from 'react';
import type { Entity, SurveySnapshot } from '../../../packages/domain/src/index';
import { SubTabs } from './SubTabs';

type Resource = Extract<Entity, { type: 'Resource' }>;
export const RESOURCE_KINDS: Record<Resource['kind'], string> = { survey: 'サーベイ', tutorial: '入門・解説', blog: 'ブログ', slides: 'スライド', talk: '講演・動画', repository: 'リポジトリ', website: 'サイト', book: '書籍', course: '講義', other: 'その他' };
const LANGUAGES: Record<string, string> = { ja: '日本語', en: '英語' };

/** 文献ガイド: surveys, tutorials, blogs and sites to read first (design 0024). */
export function LiteratureGuide({ snapshot, selected, onSelect }: { snapshot: SurveySnapshot; selected: string; onSelect: (id: string) => void }) {
  const [kind, setKind] = useState<'all' | Resource['kind']>('all');
  const resources = snapshot.entities.filter((e): e is Resource => e.type === 'Resource');
  const order = Object.keys(RESOURCE_KINDS) as Resource['kind'][];
  const present = order.filter(k => resources.some(r => r.kind === k));
  const active = kind !== 'all' && present.includes(kind) ? kind : 'all';
  const shown = resources.filter(r => active === 'all' || r.kind === active).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (b.published ?? '').localeCompare(a.published ?? ''));
  const label = (id: string) => snapshot.entities.find(e => e.id === id)?.label ?? id;
  if (!resources.length) return <div className="empty">文献なし</div>;
  return <>
    <div className="view-toolbar"><SubTabs label="文献の種類" value={active} options={[['all', 'すべて'], ...present.map(k => [k, RESOURCE_KINDS[k]] as [Resource['kind'], string])]} onChange={setKind}/></div>
    <div className="paper-list">{shown.map(r => <article key={r.id} className={`paper-card resource-card ${selected === r.id ? 'chosen' : ''}`}>
      <button className="resource-open" onClick={() => onSelect(r.id)}><h3>{r.title}</h3></button>
      {r.authors.length > 0 && <p className="paper-authors">{r.authors.slice(0, 3).join(', ')}{r.authors.length > 3 && ' ほか'}</p>}
      <div className="paper-meta"><span className="paper-represents">{RESOURCE_KINDS[r.kind]}</span>{r.published && <span>{r.published}</span>}{r.language && <span>{LANGUAGES[r.language] ?? r.language}</span>}</div>
      <p>{r.summary}</p>
      <div className="resource-links">{[...r.issues, ...r.methods].map(id => <button key={id} className="cite" onClick={() => onSelect(id)}>{label(id)}</button>)}{r.paper && <button className="cite" onClick={() => onSelect(r.paper!)}>論文の詳細</button>}<a href={r.url} target="_blank" rel="noreferrer">開く ↗</a></div>
    </article>)}</div>
  </>;
}
