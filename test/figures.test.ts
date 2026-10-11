import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveFigurePNG, validateFigurePNG, MAX_FIGURE_BYTES, assertFigureAssets } from '../scripts/figure-store';
import { applyPatch, fixture, validateSnapshot, type SurveyPatch } from '../packages/domain/src/index';
const png=readFileSync('test/fixtures/figure.png');
test('figure assets validate PNG content, reject corruption and oversized bodies, and persist immutably',()=>{
  assert.deepEqual(validateFigurePNG(png),{width:8,height:6});
  assert.throws(()=>validateFigurePNG(Buffer.from('<svg/>')),/PNG/);
  assert.throws(()=>validateFigurePNG(Buffer.alloc(MAX_FIGURE_BYTES+1)),/8MiB/);
  const corrupt=Buffer.from(png);corrupt[45]^=1;assert.throws(()=>validateFigurePNG(corrupt),/壊れ/);
  assert.throws(()=>validateFigurePNG(png.subarray(0,png.length-12)),/ありません/);
  const directory=mkdtempSync(join(tmpdir(),'survey-figure-'));
  try {
    const first=saveFigurePNG(png,directory), second=saveFigurePNG(png,directory);
    assert.deepEqual(first,second);assert.match(first.asset_id,/^[a-f0-9]{64}$/);
    assert.deepEqual(readFileSync(join(directory,`${first.asset_id}.png`)),png);
    assert.equal(readdirSync(directory).length,1);
    const snapshot=structuredClone(fixture);const paper=snapshot.entities.find(e=>e.type==='Paper')!;
    paper.representative_figure={asset_id:first.asset_id,caption:'test',source_name:'test.pdf',source_url:null,source_pdf_sha256:'a'.repeat(64),page:1,crop:{x:0,y:0,width:1,height:1},extracted_at:'2026-10-12T00:00:00Z'};
    assert.doesNotThrow(()=>assertFigureAssets(snapshot,directory));
    paper.representative_figure.asset_id='b'.repeat(64);assert.throws(()=>assertFigureAssets(snapshot,directory),/画像が見つかりません/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test('figure metadata preserves legacy snapshots and requires valid provenance and page bounds',()=>{
  const old=JSON.stringify(fixture);const paper=fixture.entities.find(e=>e.type==='Paper')!;
  const figure={asset_id:'a'.repeat(64),caption:'Fig. 1: extraction test',source_name:'test.pdf',source_url:paper.url,source_pdf_sha256:'b'.repeat(64),page:1,crop:{x:.1,y:.2,width:.4,height:.3},extracted_at:'2026-10-12T00:00:00Z'};
  const patch:SurveyPatch={schema_version:'0.1.0',base_commit_id:'v1',message:'figure',operations:[{op:'replace_entity',entity:{...paper,representative_figure:figure}}]};
  const next=applyPatch(fixture,patch,'v1');assert.equal(JSON.stringify(fixture),old);assert.deepEqual(validateSnapshot(next),[]);
  const updated=next.entities.find(e=>e.type==='Paper')!;
  updated.representative_figure!.crop.width=1;assert.match(validateSnapshot(next).join(),/ページを超え/);
  updated.representative_figure!.crop.width=.4;updated.representative_figure!.source_url='javascript:alert(1)';assert.match(validateSnapshot(next).join(),/http\/https/);
  updated.representative_figure!.source_url=paper.url;updated.representative_figure!.page=0;assert.ok(validateSnapshot(next).length);
  updated.representative_figure!.page=1;updated.representative_figure!.asset_id='invented';assert.ok(validateSnapshot(next).length);
  updated.representative_figure=null;assert.deepEqual(validateSnapshot(next),[]);
});
