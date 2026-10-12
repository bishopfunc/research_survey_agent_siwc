import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { patchSchema, applyPatch, type SurveyPatch, type SurveySnapshot } from '../packages/domain/src/index';
import { mergeRepair } from './research-run';

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const shape = ajv.compile<SurveyPatch>(patchSchema);
// Transport permits an empty final remainder; the assembled application Patch must still contain operations.
const remainderSchema = structuredClone(patchSchema);
remainderSchema.properties.operations.minItems = 0;
const remainderShape = ajv.compile<SurveyPatch>(remainderSchema);

/** A checkpoint never mutates the run snapshot. Only a complete, cumulatively valid Patch is accepted. */
export function streamCheckpoints(snapshot: SurveySnapshot, baseId: string, normalize: (value: unknown) => unknown, save: (patch: SurveyPatch, sequence: number) => void, active = () => true) {
  let accepted: SurveyPatch | undefined, sequence = 0, rejected = false;
  const validate = (patch: SurveyPatch) => applyPatch(snapshot, patch, baseId);
  return {
    accept(line: string): 'ignored' | 'saved' | 'rejected' {
      if (!active()) return 'ignored';
      let event: { type?: string; item?: { type?: string; text?: string } };
      try { event = JSON.parse(line); } catch { return 'ignored'; }
      const text = typeof event?.item?.text === 'string' ? event.item!.text!.trim() : undefined;
      if (event?.type !== 'item.completed' || event.item?.type !== 'agent_message' || !text?.startsWith('SURVEY_CHECKPOINT')) return 'ignored';
      try {
        const patch = normalize(JSON.parse(text.slice('SURVEY_CHECKPOINT'.length).trim())) as SurveyPatch;
        // Validate shape and base even when there are previously accepted operations.
        if (!shape(patch) || patch.base_commit_id !== baseId) throw Error('invalid checkpoint');
        const merged = accepted ? mergeRepair(accepted, patch) : patch;
        validate(merged);
        save(merged, sequence + 1);
        accepted = merged; sequence++;
        return 'saved';
      } catch { rejected = true; return 'rejected'; }
    },
    /** The validated checkpoints of a process that did not finish, if any were saved. */
    partial(): string | undefined {
      return accepted && JSON.stringify(accepted);
    },
    finish(raw: string): string {
      if (rejected) throw Error('途中保存に検証エラーがあり、結果の欠落を防ぐため段階を失敗にしました');
      const patch = normalize(JSON.parse(raw)) as SurveyPatch;
      if (!remainderShape(patch)) throw Error('最終出力がPatchの型に一致しません');
      if (patch.base_commit_id !== baseId) throw Error('base_commit_idが一致しません');
      // Validate shape independently; an empty temporary base is not suitable for reference validation.
      const merged = accepted ? mergeRepair(accepted, patch) : patch;
      validate(merged);
      return JSON.stringify(merged);
    },
  };
}
