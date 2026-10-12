/** A representative figure saved earlier (PNG in the figure store). Extracting new ones from a PDF was removed (user instruction 2026-10-12). */
import { useEffect, useState } from 'react';
import type { Entity } from '../../../packages/domain/src/index';
import './paper-figure.css';
type Paper = Extract<Entity,{type:'Paper'}>;
export type PaperFigure = NonNullable<Paper['representative_figure']>;
export function FigureImage({figure,compact=false}:{figure:PaperFigure;compact?:boolean}) {
  const [missing,setMissing]=useState(false);
  useEffect(()=>setMissing(false),[figure.asset_id]);
  return <figure className={`paper-figure ${compact?'compact':''}`}>{missing?<p>画像が見つかりません</p>:<img src={`/api/figures/${figure.asset_id}.png`} alt={figure.caption} loading="lazy" onError={()=>setMissing(true)}/>}<figcaption>{figure.caption}{!compact&&<small>{figure.source_name} · p.{figure.page} · {new Date(figure.extracted_at).toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'})}抽出</small>}</figcaption></figure>;
}
