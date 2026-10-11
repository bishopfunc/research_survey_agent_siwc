import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import pdfWorkerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Entity } from '../../../packages/domain/src/index';
import './paper-figure.css';
type Paper = Extract<Entity,{type:'Paper'}>;
export type PaperFigure = NonNullable<Paper['representative_figure']>;
type Crop = PaperFigure['crop'];
const previews = new Map<string,string>();
async function sha256(bytes: Uint8Array) {
  const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function FigureImage({figure,compact=false}:{figure:PaperFigure;compact?:boolean}) {
  const [missing,setMissing]=useState(false);
  useEffect(()=>setMissing(false),[figure.asset_id]);
  return <figure className={`paper-figure ${compact?'compact':''}`}>{missing?<p>画像が見つかりません。保存先のローカルサーバーを確認してください。</p>:<img src={previews.get(figure.asset_id) ?? `/api/figures/${figure.asset_id}.png`} alt={figure.caption} loading="lazy" onError={()=>setMissing(true)}/>}<figcaption>{figure.caption}{!compact&&<small>{figure.source_name} · p.{figure.page} · {new Date(figure.extracted_at).toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'})}抽出</small>}</figcaption></figure>;
}
export function FigureExtractor({paper,preview,onSave,onClose}:{paper:Paper;preview:boolean;onSave:(figure:PaperFigure)=>void;onClose:()=>void}) {
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null);
  const [source,setSource]=useState({name:'',hash:''});
  const [page,setPage]=useState(1);
  const [crop,setCrop]=useState<Crop>({x:0,y:0,width:1,height:1});
  const [caption,setCaption]=useState(paper.representative_figure?.caption ?? '');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [rendered,setRendered]=useState(false);
  const canvas=useRef<HTMLCanvasElement>(null);
  const start=useRef<{x:number;y:number}|null>(null);
  const loadVersion=useRef(0);
  const document=useRef<PDFDocumentLoadingTask|null>(null);
  useEffect(()=>()=>{loadVersion.current++;void document.current?.destroy();},[]);
  useEffect(()=>{
    if(!pdf || !canvas.current)return;
    let active=true;let task:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;
    setRendered(false);setCrop({x:0,y:0,width:1,height:1});setError('');
    void pdf.getPage(page).then(async p=>{
      if(!active)return;
      const base=p.getViewport({scale:1});const viewport=p.getViewport({scale:Math.min(2,1600/base.width,3000/base.height)});
      const c=canvas.current!;c.width=Math.ceil(viewport.width);c.height=Math.ceil(viewport.height);
      task=p.render({canvas:c,canvasContext:c.getContext('2d')!,viewport});await task.promise;
      if(active)setRendered(true);
    }).catch(()=>{if(active)setError('このページを表示できませんでした。別のPDFを確認してください');});
    return ()=>{active=false;task?.cancel();};
  },[pdf,page]);
  async function load(file:File) {
    const version=++loadVersion.current;void document.current?.destroy();document.current=null;setBusy(true);setError('');setRendered(false);setPdf(null);
    try {
      if(file.size>30*1024*1024)throw Error('PDFは30MiB以下にしてください');
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw Error('PDFファイルを選んでください');
      const hash=await sha256(bytes);
      const lib=await import('pdfjs-dist');lib.GlobalWorkerOptions.workerSrc=pdfWorkerURL;
      if(version!==loadVersion.current)return;
      const task=lib.getDocument({data:bytes,useSystemFonts:true});document.current=task;
      const loaded=await task.promise;
      if(version!==loadVersion.current){void task.destroy();return;}
      setSource({name:file.name,hash});setPage(1);setPdf(loaded);
    } catch(e){if(version===loadVersion.current)setError(e instanceof Error?e.message:'PDFを読み込めませんでした');}
    finally {if(version===loadVersion.current)setBusy(false);}
  }
  function point(e:PointerEvent<HTMLDivElement>){const r=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
  function move(e:PointerEvent<HTMLDivElement>){if(!start.current)return;const p=point(e);setCrop({x:Math.min(p.x,start.current.x),y:Math.min(p.y,start.current.y),width:Math.abs(p.x-start.current.x),height:Math.abs(p.y-start.current.y)});}
  async function save() {
    if(!rendered || !canvas.current)return;setBusy(true);setError('');
    try {
      if(!caption.trim())throw Error('Figのキャプションを入力してください');
      if(crop.width<=0 || crop.height<=0 || crop.x+crop.width>1.000001 || crop.y+crop.height>1.000001)throw Error('切り出し範囲をページ内に指定してください');
      const c=canvas.current;const output=window.document.createElement('canvas');
      output.width=Math.max(1,Math.round(c.width*crop.width));output.height=Math.max(1,Math.round(c.height*crop.height));
      output.getContext('2d')!.drawImage(c,c.width*crop.x,c.height*crop.y,c.width*crop.width,c.height*crop.height,0,0,output.width,output.height);
      const png=await new Promise<Blob>((resolve,reject)=>output.toBlob(b=>b?resolve(b):reject(Error('画像を作成できませんでした')),'image/png'));
      if(png.size>8*1024*1024)throw Error('画像は8MiB以下にしてください。範囲を小さくしてください');
      const asset_id=await sha256(new Uint8Array(await png.arrayBuffer()));
      if(preview)previews.set(asset_id,URL.createObjectURL(png));
      else {const res=await fetch('/api/figures',{method:'POST',headers:{'Content-Type':'image/png'},body:png});const result=await res.json();if(!res.ok)throw Error(result.error ?? '画像を保存できませんでした');if(result.asset_id!==asset_id)throw Error('画像の照合に失敗しました');}
      onSave({asset_id,caption:caption.trim(),source_name:source.name,source_url:paper.url,source_pdf_sha256:source.hash,page,crop,extracted_at:new Date().toISOString()});onClose();
    }catch(e){setError(e instanceof Error?e.message:'画像を保存できませんでした');}finally{setBusy(false);}
  }
  return <div className="modal-backdrop"><section className="edit-modal figure-modal" role="dialog" aria-modal="true" aria-labelledby="figure-title"><div className="modal-heading"><h2 id="figure-title">{paper.label}の代表Fig</h2><button disabled={busy} aria-label="Fig抽出を閉じる" onClick={onClose}>×</button></div><p>論文PDFを選び、代表的な図の範囲を切り出します。</p><label className="figure-file">論文PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e=>{if(e.target.files?.[0])void load(e.target.files[0]);}}/></label>{pdf&&<><div className="figure-page"><button disabled={busy||page===1} onClick={()=>setPage(page-1)}>前のページ</button><span>{page} / {pdf.numPages}</span><button disabled={busy||page===pdf.numPages} onClick={()=>setPage(page+1)}>次のページ</button></div><p className="figure-hint">図をドラッグで囲むか、範囲を数値で指定してください。</p><div className="figure-canvas" role="group" aria-label="PDFページと切り出し範囲" onPointerDown={e=>{if(!rendered||busy)return;start.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={move} onPointerUp={e=>{move(e);start.current=null;}} onPointerCancel={()=>{start.current=null;}}><canvas ref={canvas}/>{rendered&&<div className="figure-selection" style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.width*100}%`,height:`${crop.height*100}%`}}/>}</div><div className="figure-crop">{(['x','y','width','height'] as const).map(k=><label key={k}>{{x:'左端',y:'上端',width:'幅',height:'高さ'}[k]} %<input type="number" aria-label={`Figの${k}`} min={0} max={100} step={.1} disabled={busy||!rendered} value={Math.round(crop[k]*10000)/100} onChange={e=>setCrop({...crop,[k]:Number(e.target.value)/100})}/></label>)}</div></>}<label className="figure-caption">キャプション<textarea value={caption} disabled={busy} onChange={e=>setCaption(e.target.value)} placeholder="例：Fig. 2 — 手法の全体像"/></label>{preview&&<p className="figure-hint">レビュー用：画像と変更はプレビュー内だけに保存します。</p>}{error&&<p role="alert" className="validation-errors">{error}</p>}<div className="modal-actions"><button disabled={busy} onClick={onClose}>閉じる</button><button className="primary" disabled={busy||!rendered} onClick={()=>void save()}>{busy?'処理中…':'Figを保存して新しい版を作る'}</button></div></section></div>;
}
