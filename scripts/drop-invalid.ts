// Removing what the validator rejects instead of asking Codex to repair it (design 0037): used where there is no time for a repair
// run (a one-minute revise) and for each paper's reading, which must not lose all of its facts to one bad operation.
import type { SurveyPatch } from '../packages/domain/src/index';

type Operation = SurveyPatch['operations'][number];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const targetOf = (op: Operation) => 'entity' in op ? op.entity.id : 'relation' in op ? op.relation.id : 'id' in op ? op.id : null;
/** The ID an error line is about: "<id>: …", "<id>の節N: …" (a tutorial section) or "<id>の要点（…）: …" (a paper reading). */
const ownerOf = (line: string) => line.match(/^\s*([^\s:：]+?)(?:の節\d+|の要点(?:（[^）]*）)?)?\s*[:：]/)?.[1];
const mentions = (errors: string, id: string) => new RegExp(`(?<![\\w-])${escape(id)}(?![\\w-])`).test(errors);

/** Drops the operations the validator's errors name (by their ID, or by /operations/N), and the relations to an entity the
 * patch added and then lost, until the patch validates; at most `rounds` rounds. Null when an error names nothing it can drop, or
 * nothing is left. An error line that starts with an operation's ID ("family-x: …", "tutorialの節3: …") names that operation only;
 * other IDs on the line (a Domain named as context) count only when the line's owner is not in the patch. `saved` gives the
 * version of a target that was already validated (a saved checkpoint): a named operation goes back to it once, instead of going. */
export function dropInvalid(patch: SurveyPatch, validate: (patch: SurveyPatch) => void, rounds = 3, saved?: (target: string) => Operation | undefined): { patch: SurveyPatch; dropped: number } | null {
  let current = patch, dropped = 0;
  const restored = new Set<string>();
  for (let round = 0; round <= rounds; round++) {
    let errors: string;
    try { validate(current); return { patch: current, dropped }; } catch (error) { errors = error instanceof Error ? error.message : String(error); }
    if (round === rounds) return null;
    const removed = new Set<string>(), targets = new Set(current.operations.map(targetOf).filter((id): id is string => id !== null));
    const namedIds = new Set<string>();
    for (const line of errors.split('\n')) {
      const owner = ownerOf(line);
      if (owner && targets.has(owner)) namedIds.add(owner);
      else for (const id of targets) if (mentions(line, id)) namedIds.add(id);
    }
    let changed = false;
    const keep = current.operations.flatMap((op, i) => {
      const id = targetOf(op);
      const named = new RegExp(`/operations/${i}(?!\\d)`).test(errors) || (id !== null && namedIds.has(id));
      if (!named) return [op];
      // A saved version of the target replaces the failing one once (a held correction, a bad re-send in the final response).
      const back = id !== null && !restored.has(id) ? saved?.(id) : undefined;
      if (back && JSON.stringify(back) !== JSON.stringify(op)) { restored.add(id!); changed = true; return [back]; }
      // Only an entity the patch adds is gone when its operation goes: a dropped replace leaves the stored entity, and relations to it.
      if (id && op.op === 'add_entity') removed.add(id);
      return [];
    });
    // A relation to an entity that was just dropped would only fail next round.
    const next = keep.filter(op => !(op.op === 'add_relation' && (removed.has(op.relation.from) || removed.has(op.relation.to))));
    if ((next.length === current.operations.length && !changed) || !next.length) return null;
    dropped += current.operations.length - next.length;
    current = { ...current, operations: next as SurveyPatch['operations'] };
  }
  return null;
}
