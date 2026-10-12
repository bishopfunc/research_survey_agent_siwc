import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import snapshotSchema from '../schema/snapshot.schema.json';
import patchSchema from '../schema/patch.schema.json';
import fixtureJSON from './fixture.json';
import type { Entity, Relation, SurveySnapshot } from './snapshot.types';
import type { SurveyPatch } from './patch.types';
export type { Entity, Relation, SurveySnapshot, SurveyPatch };
export { snapshotSchema, patchSchema };
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const shape = ajv.compile<SurveySnapshot>(snapshotSchema);
const patchShape = ajv.compile<SurveyPatch>(patchSchema);
export const fixture = fixtureJSON as SurveySnapshot;
export const emptySurvey = (title: string): SurveySnapshot => ({ schema_version: '0.1.0', title, entities: [], relations: [] });
type AjvError = NonNullable<typeof shape.errors>[number];
const describe = (e: AjvError, prefix = '') => `${prefix}${e.instancePath || (prefix ? '' : '/')} ${e.message}${e.keyword === 'additionalProperties' ? ` (${(e.params as { additionalProperty?: string }).additionalProperty})` : ''}`;
const entityShape = Object.fromEntries(snapshotSchema.$defs.Entity.anyOf.map(ref => {
  const name = ref.$ref.split('/').at(-1)!;
  return [name, ajv.compile({ $defs: snapshotSchema.$defs, $ref: `#/$defs/${name}` })];
}));
/** Reports entity errors against the definition its `type` names, so the other branches of the Entity union do not hide the cause. */
function formatErrors(errors: typeof shape.errors, value: unknown, kind: 'snapshot' | 'patch') {
  const entities: [unknown, string][] = kind === 'patch'
    ? ((value as { operations?: unknown[] })?.operations ?? []).flatMap((op, i) => op && typeof op === 'object' && 'entity' in op ? [[(op as { entity: unknown }).entity, `/operations/${i}/entity`] as [unknown, string]] : [])
    : ((value as { entities?: unknown[] })?.entities ?? []).map((e, i) => [e, `/entities/${i}`] as [unknown, string]);
  const precise: string[] = []; const covered: string[] = [];
  for (const [entity, path] of entities) {
    const check = entityShape[String((entity as { type?: unknown })?.type)];
    if (!check) continue;
    covered.push(path);
    if (!check(entity)) {
      precise.push(...(check.errors ?? []).map(e => describe(e, path)));
      // The other operation variants (relation, id, title…) only add noise once the entity error is known.
      if (kind === 'patch') covered.push(path.replace(/\/entity$/, ''));
    }
  }
  const generic = (errors ?? []).filter(e => !covered.some(path => e.instancePath === path || e.instancePath.startsWith(`${path}/`))).map(e => describe(e));
  return [...new Set([...precise, ...generic])].slice(0, 12);
}

/** The relations the app shows and Codex writes (user instruction 2026-10-12, ADR 0015): parents and children of issues
 * and methods, families, papers to their methods and issues, and claims with their evidence. Older surveys may hold
 * other relation types; they stay valid but are no longer written or shown. */
export const CORE_RELATION_TYPES = ['part_of', 'specializes', 'extends', 'builds_on', 'instance_of', 'proposes', 'addresses', 'about', 'supports', 'contradicts'] as const;
/** Allowed entity types at each end of a typed relation (from, to). Relations not listed accept any entity. Shared with the agent prompt. */
export const RELATION_ENDPOINTS: Partial<Record<Relation['type'], [string[], string[]]>> = {
  part_of: [['Issue', 'Domain'], ['Issue', 'Domain']], specializes: [['Issue', 'Method'], ['Issue', 'Method']],
  addresses: [['Method', 'Paper'], ['Issue']], proposes: [['Paper'], ['Method']],
  introduces_issue: [['Method'], ['Issue']], extends: [['Method'], ['Method']], builds_on: [['Method'], ['Method']],
  instance_of: [['Issue', 'Method'], ['Concept']], supports: [['Paper', 'Claim', 'Evidence'], ['Claim']],
  about: [['Claim'], ['Issue', 'Method', 'Concept', 'Domain']],
  contradicts: [['Paper', 'Claim', 'Evidence'], ['Claim']], refines: [['Claim'], ['Claim']],
};
export function validateSnapshot(value: unknown): string[] {
  if (!shape(value)) return formatErrors(shape.errors, value, 'snapshot');
  const errors: string[] = [];
  const entities = new Map(value.entities.map(e => [e.id, e]));
  if (entities.size !== value.entities.length) errors.push('Entity IDが重複しています');
  if (new Set(value.relations.map(r => r.id)).size !== value.relations.length) errors.push('Relation IDが重複しています');
  const reference = (owner: string, id: string, types?: string[]) => {
    const e = entities.get(id);
    if (!e) errors.push(`${owner}: 参照先 ${id} がありません`);
    else if (types && !types.includes(e.type)) errors.push(`${owner}: ${id} は ${types.join('/')} 型が必要です`);
  };
  for (const e of value.entities) {
    if (e.type === 'Paper') {
      for (const [field, type] of [['proposes', 'Method'], ['addresses', 'Issue'], ['claims', 'Claim'], ['evidence', 'Evidence']] as const)
        for (const id of e[field]) reference(e.id, id, [type]);
      if (e.citation_count !== null && (!e.citation_source || !e.citation_as_of)) errors.push(`${e.id}: 引用数にはsourceとas_ofが必要です`);
      const code = e.code_availability ?? 'unknown';
      const fig = e.representative_figure;
      if (fig) {
        if (fig.source_url && !/^https?:\/\//.test(fig.source_url)) errors.push(`${e.id}: Fig出典はhttp/httpsのみ対応します`);
        if (fig.crop.x + fig.crop.width > 1.000001 || fig.crop.y + fig.crop.height > 1.000001) errors.push(`${e.id}: Figの範囲がページを超えています`);
      }
      if (e.abstract?.trim() && !e.abstract_source_url) errors.push(`${e.id}: アブストラクトには取得元のURLが必要です`);
      if (e.abstract_source_url && !e.abstract?.trim()) errors.push(`${e.id}: アブストラクトの原文が無いのに取得元URLがあります`);
      if (e.abstract_source_url && !/^https?:\/\//.test(e.abstract_source_url)) errors.push(`${e.id}: アブストラクトの取得元URLはhttp/httpsのみ対応します`);
      if (e.abstract_ja?.trim() && !e.abstract?.trim()) errors.push(`${e.id}: 和訳には元のアブストラクト（原文）が必要です`);
      if (e.reading?.sources?.some(s => !/^https?:\/\//.test(s.url))) errors.push(`${e.id}: 要点の出典はhttp/httpsのみ対応します`);
      for (const id of e.reading?.evidence ?? []) reference(`${e.id}の要点`, id, ['Evidence']);
      if (e.code_url && !/^https?:\/\//.test(e.code_url)) errors.push(`${e.id}: コードURLはhttp/httpsのみ対応します`);
      if (code === 'public' && (!e.code_url || !e.code_checked_at)) errors.push(`${e.id}: コード公開ありには公開URLと確認日が必要です`);
      if (code === 'not_found' && (!e.code_checked_at || e.code_url)) errors.push(`${e.id}: コードが見つからずには確認日が必要で、公開URLは空にしてください`);
      if (code === 'unknown' && (e.code_url || e.code_checked_at)) errors.push(`${e.id}: コード未確認では公開URLと確認日を空にしてください`);
    }
    if (e.type === 'Claim') {
      for (const id of e.evidence) reference(e.id, id, ['Evidence']);
      if (e.status !== 'unknown' && (!e.evidence.length || !e.as_of)) errors.push(`${e.id}: 解決状態の評価にはEvidenceとas_ofが必要です`);
    }
    // Facts cite their sources (design 0025): issues, methods, families and knowledge items point at Evidence.
    if ((e.type === 'Issue' || e.type === 'Method' || e.type === 'Concept' || e.type === 'Keyword') && e.evidence) for (const id of e.evidence) reference(e.id, id, ['Evidence']);
    if (e.type === 'Evidence') {
      if (e.origin) reference(e.id, e.origin, ['Paper', 'Resource']);
      if (!/^https?:\/\//.test(e.source_url)) errors.push(`${e.id}: 出典はhttp/https URLが必要です`);
      if (e.provenance === 'codex' && e.verification === 'verified') errors.push(`${e.id}: Codexの生成だけで原文確認済みにはできません`);
      if (e.verification === 'verified' && (!e.excerpt.trim() || !e.retrieved_at || !e.content_hash)) errors.push(`${e.id}: verifiedには本文断片・取得日・hashが必要です`);
      if (e.verification === 'abstract_only' && !e.excerpt.trim()) errors.push(`${e.id}: 要旨のみ確認には要旨の原文（断片）が必要です`);
    }
    if (e.type === 'Paper' && e.url && !/^https?:\/\//.test(e.url)) errors.push(`${e.id}: URLはhttp/httpsのみ対応します`);
    if (e.type === 'Keyword') {
      for (const id of e.papers) reference(e.id, id, ['Paper']);
      for (const id of e.related) reference(e.id, id, ['Issue', 'Method', 'Concept', 'Domain']);
      if (e.definition_excerpt.trim() && !e.source_url) errors.push(`${e.id}: 定義の原文には取得元URLが必要です`);
      if (e.source_url && !/^https?:\/\//.test(e.source_url)) errors.push(`${e.id}: ナレッジの出典はhttp/httpsのみ対応します`);
      if (e.official_url && !/^https?:\/\//.test(e.official_url)) errors.push(`${e.id}: 公式ページはhttp/httpsのみ対応します`);
      if (e.category === 'sota' && (!e.as_of || !e.papers.length)) errors.push(`${e.id}: SOTAには時点（as_of）と根拠の論文が必要です`);
    }
    if (e.type === 'Resource') {
      if (!/^https?:\/\//.test(e.url)) errors.push(`${e.id}: 文献のURLはhttp/httpsのみ対応します`);
      for (const id of e.issues) reference(e.id, id, ['Issue']);
      for (const id of e.methods) reference(e.id, id, ['Method']);
      if (e.paper) reference(e.id, e.paper, ['Paper']);
    }
    if (e.type === 'Tutorial') {
      e.sections.forEach((section, i) => {
        const owner = `${e.id}の節${i + 1}`;
        const cited = [...section.body.matchAll(/\[@([^\]\s]+)\]/g)].map(m => m[1]);
        for (const id of [...section.refs, ...cited]) reference(owner, id, ['Domain', 'Concept', 'Issue', 'Method', 'Paper', 'Claim', 'Keyword', 'Resource']);
        for (const m of section.media) reference(owner, m.paper, ['Paper']);
        if (section.links.some(l => !/^https?:\/\//.test(l.url))) errors.push(`${owner}: リンクはhttp/httpsのみ対応します`);
      });
    }
  }
  if (value.entities.filter(e => e.type === 'Tutorial').length > 1) errors.push('チュートリアルは1つの調査に1つだけです');
  const typed = RELATION_ENDPOINTS;
  const triples = new Set<string>();
  for (const r of value.relations) {
    const allowed = typed[r.type]; reference(r.id, r.from, allowed?.[0]); reference(r.id, r.to, allowed?.[1]);
    if (r.from === r.to) errors.push(`${r.id}: 自己参照は許可されません`);
    const key = `${r.type}:${r.from}:${r.to}`;
    if (triples.has(key)) errors.push(`${r.id}: 同じ関係が重複しています`);
    triples.add(key);
    if (r.type === 'specializes' && entities.get(r.from)?.type !== entities.get(r.to)?.type) errors.push(`${r.id}: specializesは同じ型の間で使います`);
  }
  const hierarchy = value.relations.filter(r => r.type === 'part_of' || r.type === 'specializes');
  const parents = new Map<string, string[]>();
  for (const r of hierarchy) parents.set(r.from, [...(parents.get(r.from) ?? []), r.to]);
  const visiting = new Set<string>(), visited = new Set<string>();
  function cycle(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((parents.get(id) ?? []).some(cycle)) return true;
    visiting.delete(id); visited.add(id); return false;
  }
  if (value.entities.some(e => cycle(e.id))) errors.push('part_of / specializesに循環があります');
  const methodParents = new Map<string, string[]>();
  for (const r of value.relations) if (['extends', 'builds_on', 'specializes'].includes(r.type) && entities.get(r.from)?.type === 'Method' && entities.get(r.to)?.type === 'Method') methodParents.set(r.from,[...(methodParents.get(r.from) ?? []),r.to]);
  visiting.clear(); visited.clear();
  function methodCycle(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((methodParents.get(id) ?? []).some(methodCycle)) return true;
    visiting.delete(id); visited.add(id); return false;
  }
  if (value.entities.some(e => e.type === 'Method' && methodCycle(e.id))) errors.push('手法の派生関係に循環があります');
  return errors;
}

export function applyPatch(snapshot: SurveySnapshot, patch: unknown, commitId: string): SurveySnapshot {
  if (!patchShape(patch)) throw Error(formatErrors(patchShape.errors, patch, 'patch').join('\n'));
  if (patch.base_commit_id !== commitId) throw Error('base_commitが変わっています。最新の版で再提案してください');
  const next = structuredClone(snapshot);
  for (const op of patch.operations) {
    if (op.op === 'set_title') { next.title = op.title; continue; }
    const isEntity = 'entity' in op || op.op === 'remove_entity';
    const collection: (Entity | Relation)[] = isEntity ? next.entities : next.relations;
    const item = 'entity' in op ? op.entity : 'relation' in op ? op.relation : null;
    const id = item?.id ?? ('id' in op ? op.id : '');
    const index = collection.findIndex(e => e.id === id);
    if (op.op.startsWith('add_')) {
      if (index >= 0) throw Error(`ID ${id} は既に存在します`);
      collection.push(structuredClone(item!));
    } else {
      if (index < 0) throw Error(`ID ${id} が存在しません`);
      if (item) collection[index] = structuredClone(item); else collection.splice(index, 1);
    }
  }
  const errors = validateSnapshot(next);
  if (errors.length) throw Error(errors.join('\n'));
  return next;
}

export interface LocalCommit { id: string; parents: string[]; created_at: string; message: string; snapshot: SurveySnapshot; source: 'fixture' | 'user' | 'codex'; instruction: string | null; run_id: string | null; patch: SurveyPatch | null }
export interface Workspace { version: 1; commits: LocalCommit[]; branches: { id: string; name: string; head: string; forked_from: string | null }[]; active_branch: string }
export function makeCommit(snapshot: SurveySnapshot, parents: string[], message: string, source: LocalCommit['source'] = 'user', instruction: string | null = null, run_id: string | null = null, patch: SurveyPatch | null = null): LocalCommit {
  const errors = validateSnapshot(snapshot); if (errors.length) throw Error(errors.join('\n'));
  return { id: crypto.randomUUID(), parents, created_at: new Date().toISOString(), message, snapshot: structuredClone(snapshot), source, instruction, run_id, patch };
}
/** The sample's chat: the request it answers and three follow-ups, one for each kind of additional request (design 0023). */
export const SAMPLE_CHAT = {
  instruction: 'マルチエージェント経路計画（MAPF）を網羅的にサーベイ',
  message: 'MAPFのサンプル：課題7・手法10（系統3）・論文14・文献ガイド・ナレッジ・チュートリアルを、論文と文献の出典つきでまとめた。',
  follow_ups: ['lifelong MAPFの2024年以降の手法を深掘りして', '実機ロボットでの運用と安全性の観点で調べて', 'LaCAMとPIBTの違いを解説して'] as [string, string, string],
};
/** The first version of a sample collection, carrying the sample's chat. */
export function sampleCommit(snapshot = fixture): LocalCommit {
  return makeCommit(snapshot, [], SAMPLE_CHAT.message, 'fixture', SAMPLE_CHAT.instruction, null, { schema_version: '0.1.0', base_commit_id: 'sample', message: SAMPLE_CHAT.message, follow_ups: SAMPLE_CHAT.follow_ups, operations: [] as unknown as SurveyPatch['operations'] }); // no operations: the patch only carries the chat's follow-ups
}
export function initialWorkspace(snapshot = fixture): Workspace {
  const c = snapshot === fixture ? sampleCommit() : makeCommit(snapshot, [], '初期サンプル', 'fixture');
  return { version: 1, commits: [c], branches: [{ id: 'main', name: 'main', head: c.id, forked_from: null }], active_branch: 'main' };
}
/** Removes a collection (branch). Commits still reachable from other branches stay untouched; unreachable ones are dropped. */
export function deleteBranch(workspace: Workspace, branchId: string): Workspace {
  if (!workspace.branches.some(b => b.id === branchId)) throw Error('コレクションが見つかりません');
  if (workspace.branches.length === 1) throw Error('最後のコレクションは削除できません');
  const branches = workspace.branches.filter(b => b.id !== branchId);
  const byId = new Map(workspace.commits.map(c => [c.id, c]));
  const reachable = new Set<string>();
  const visit = (id: string) => { if (reachable.has(id)) return; reachable.add(id); byId.get(id)?.parents.forEach(visit); };
  branches.forEach(b => visit(b.head));
  return { ...workspace, branches, commits: workspace.commits.filter(c => reachable.has(c.id)), active_branch: workspace.active_branch === branchId ? branches[0].id : workspace.active_branch };
}
export function validateWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== 'object') return false;
  const w = value as Workspace;
  if (w.version !== 1 || !Array.isArray(w.commits) || !Array.isArray(w.branches) || !w.branches.length || !w.commits.length) return false;
  if (new Set(w.commits.map(c => c.id)).size !== w.commits.length || new Set(w.branches.map(b => b.id)).size !== w.branches.length) return false;
  const ids = new Set(w.commits.map(c => c.id));
  return w.commits.every(c => typeof c.id === 'string' && typeof c.message === 'string' && typeof c.created_at === 'string' && Array.isArray(c.parents) && c.parents.every(p => ids.has(p)) && validateSnapshot(c.snapshot).length === 0)
    && w.branches.every(b => typeof b.name === 'string' && ids.has(b.head)) && w.branches.some(b => b.id === w.active_branch);
}
