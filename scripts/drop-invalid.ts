// Removing what the validator rejects instead of asking Codex to repair it (design 0037): used where there is no time for a repair
// run (a one-minute revise) and for each paper's reading, which must not lose all of its facts to one bad operation.
import type { SurveyPatch } from '../packages/domain/src/index';

type Operation = SurveyPatch['operations'][number];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const targetOf = (op: Operation) => 'entity' in op ? op.entity.id : 'relation' in op ? op.relation.id : 'id' in op ? op.id : null;
const mentions = (errors: string, id: string) => new RegExp(`(?<![\\w-])${escape(id)}(?![\\w-])`).test(errors);

/** Drops the operations the validator's errors name (by their ID, or by /operations/N), and the relations to an entity that was
 * dropped, until the patch validates; at most `rounds` rounds. Null when an error names nothing it can drop, or nothing is left. */
export function dropInvalid(patch: SurveyPatch, validate: (patch: SurveyPatch) => void, rounds = 3): { patch: SurveyPatch; dropped: number } | null {
  let current = patch, dropped = 0;
  for (let round = 0; round <= rounds; round++) {
    let errors: string;
    try { validate(current); return { patch: current, dropped }; } catch (error) { errors = error instanceof Error ? error.message : String(error); }
    if (round === rounds) return null;
    const removed = new Set<string>();
    const keep = current.operations.filter((op, i) => {
      const id = targetOf(op);
      const named = new RegExp(`/operations/${i}(?!\\d)`).test(errors) || (id !== null && mentions(errors, id));
      if (named && id) removed.add(id);
      return !named;
    });
    // A relation to an entity that was just dropped would only fail next round.
    const next = keep.filter(op => !(op.op === 'add_relation' && (removed.has(op.relation.from) || removed.has(op.relation.to))));
    if (next.length === current.operations.length || !next.length) return null;
    dropped += current.operations.length - next.length;
    current = { ...current, operations: next as SurveyPatch['operations'] };
  }
  return null;
}
