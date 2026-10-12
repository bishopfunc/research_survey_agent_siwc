/** Scores a new-survey run against the survey and tutorial test requirements (design 0019).
 * Usage: npm run survey:assess -- .poc/runs/<run id>   (or a patch.json path). Exits 1 when a requirement fails. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPatch, emptySurvey, type SurveyPatch } from '../packages/domain/src/index';
import { stripCodexNulls } from '../packages/domain/src/codex-schema';
import { snapshotSchema } from '../packages/domain/src/index';
import { assessSurvey } from '../packages/domain/src/survey-assessment';
import { assessTutorial } from '../packages/domain/src/tutorial';

const target = process.argv[2];
if (!target) { console.error('usage: npm run survey:assess -- <run directory | patch.json>'); process.exit(2); }
const file = existsSync(join(target, 'patch.json')) ? join(target, 'patch.json') : target;
const patch = stripCodexNulls(JSON.parse(readFileSync(file, 'utf8')), snapshotSchema.$defs as Record<string, Record<string, unknown>>) as SurveyPatch;
const snapshot = applyPatch(emptySurvey('新規調査'), patch, patch.base_commit_id);
const survey = assessSurvey(snapshot), tutorial = assessTutorial(snapshot);
const line = (c: { pass: boolean; label: string; detail: string }) => `${c.pass ? '✓' : '✗'} ${c.label}（${c.detail}）`;
console.log(`${snapshot.title}：操作${patch.operations.length}件`);
console.log('調査の要件'); survey.forEach(c => console.log('  ' + line(c)));
console.log('チュートリアルの要件'); tutorial.forEach(c => console.log('  ' + line(c)));
process.exit([...survey, ...tutorial].every(c => c.pass) ? 0 : 1);
