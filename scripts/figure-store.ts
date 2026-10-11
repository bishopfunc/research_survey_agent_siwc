import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { SurveySnapshot } from '../packages/domain/src/index';
export const MAX_FIGURE_BYTES = 8 * 1024 * 1024;
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function validateFigurePNG(bytes: Buffer) {
  if (bytes.length > MAX_FIGURE_BYTES || bytes.length < 57 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('PNG形式の画像が必要です（最大8MiB）');
  let offset=8, width=0, height=0, channels=0, ended=false;
  const data: Buffer[]=[];
  while(offset < bytes.length) {
    if (offset+12>bytes.length) throw Error('PNGが壊れています');
    const length=bytes.readUInt32BE(offset), end=offset+12+length;
    if(end>bytes.length) throw Error('PNGが壊れています');
    const type=bytes.toString('ascii',offset+4,offset+8), chunk=bytes.subarray(offset+8,offset+8+length);
    if(crc32(bytes.subarray(offset+4,offset+8+length))!==bytes.readUInt32BE(offset+8+length)) throw Error('PNGが壊れています');
    if(offset===8 && type!=='IHDR') throw Error('PNGのヘッダがありません');
    if(type==='IHDR') {
      if(offset!==8 || length!==13) throw Error('PNGのヘッダが不正です');
      width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);channels=chunk[9]===6?4:chunk[9]===2?3:0;
      if(!width || !height || width>4096 || height>4096 || !channels || chunk[8]!==8 || chunk[10] || chunk[11] || chunk[12]) throw Error('画像は4096px以下のRGB/RGBA PNGにしてください');
    } else if(type==='IDAT') data.push(chunk);
    else if(type==='IEND') { if(length || end!==bytes.length) throw Error('PNGの末尾が不正です');ended=true;break; }
    else if(type[0]===type[0].toUpperCase()) throw Error('未対応のPNG形式です');
    offset=end;
  }
  if(!ended || !data.length) throw Error('PNGの画像データがありません');
  const row=width*channels+1, expected=row*height;
  let raw: Buffer;
  try { raw=inflateSync(Buffer.concat(data),{maxOutputLength:expected}); } catch { throw Error('PNGの画像データが不正です'); }
  if(raw.length!==expected) throw Error('PNGの画像サイズが不正です');
  for(let y=0;y<height;y++) if(raw[y*row]>4) throw Error('PNGの画像データが不正です');
  return {width,height};
}
export function saveFigurePNG(bytes: Buffer, directory: string) {
  validateFigurePNG(bytes);
  const asset_id=createHash('sha256').update(bytes).digest('hex');
  mkdirSync(directory,{recursive:true,mode:0o700});
  try {writeFileSync(join(directory,`${asset_id}.png`),bytes,{mode:0o600,flag:'wx'});}
  catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;}
  return {asset_id};
}
export function assertFigureAssets(snapshot: SurveySnapshot, directory: string) {
  for (const paper of snapshot.entities) if(paper.type==='Paper' && paper.representative_figure) {
    if(!/^[a-f0-9]{64}$/.test(paper.representative_figure.asset_id) || !existsSync(join(directory,`${paper.representative_figure.asset_id}.png`))) throw Error(`${paper.label}: 保存済みのFig画像が見つかりません。PDFから抽出して保存してください`);
  }
}
