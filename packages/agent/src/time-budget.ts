/** Shared by the runner and Lab. A soft research deadline reserves time for serialization. */
export const BUDGET_PROMPT_VERSION = 'survey-budget@2026-10-14T11:13+09:00';
export const STOP_GRACE_MS = 5_000;
export function timeBudget(totalSeconds: number, writeSeconds = Math.min(180, Math.max(30, Math.floor(totalSeconds * 0.4)))) {
  const writing = Math.min(writeSeconds, Math.floor(totalSeconds / 2));
  return { totalSeconds, researchSeconds: totalSeconds - writing, writeSeconds: writing };
}
/** How Codex runs (design 0036): app-server lets the server steer the turn and take results through a tool; exec is the fallback. */
export type CodexTransport = 'app-server' | 'exec';
export function budgetInstructions(totalSeconds: number, startedAt: number, writeSeconds?: number, transport: CodexTransport = 'app-server') {
  const b = timeBudget(totalSeconds, writeSeconds);
  const at = (seconds: number) => new Date(startedAt + seconds * 1000).toISOString();
  const steered = transport === 'app-server' ? ' At the research deadline the server also sends you a message in this turn; follow it at once.' : '';
  return `Execution budget: ${b.totalSeconds} seconds total. Research deadline: ${at(b.researchSeconds)} (${b.researchSeconds} seconds from start). Hard stop: ${at(b.totalSeconds)}. Reserve the final ${b.writeSeconds} seconds for writing the structured result. Use the current time available in code mode to check the deadline between tool calls. Stop new searches and reading at the research deadline, use only information already collected, finish the JSON and describe any missing coverage in message. Never invent facts to fill gaps. If writing will take longer, stop research earlier.${steered} The server terminates this process at the hard stop; a prompt deadline is not an extension.`;
}
export const CHECKPOINT_INSTRUCTIONS = 'Incremental output (this mode explicitly permits commentary checkpoints as an exception to the schema-only output rule; the final response still conforms to the supplied schema): as soon as a self-contained result is ready (one paper with its facts and sources, or about 5–10 operations), send a commentary message consisting of SURVEY_CHECKPOINT followed by one complete JSON Patch with schema_version, base_commit_id, message, operations. Include dependencies in the same or an earlier checkpoint: no dangling references. Keep new IDs stable and unique. Do not send incomplete JSON or markdown fences. The server validates and saves each completed checkpoint; it is not a Commit. The final schema-constrained response is a Patch containing only the operations not already sent, plus the final message and follow_ups; operations may be empty if everything was checkpointed. Do not repeat earlier operations unless correcting them. If commentary is unavailable, return the complete Patch in the final response.';

/** The client tool of app-server steps that save their results as they go (design 0036). Its input schema stays small, because
 * Codex shortens tool schemas over 5,000 bytes; the operations take the shapes of the final response schema. */
export const SUBMIT_PATCH_TOOL = {
  name: 'submit_patch',
  description: 'Save part of your result now: a short message and the operations ready so far (for example one paper with its facts and sources, or about 5–10 operations). Each operation has exactly the shape of an item of operations in the final response schema. The server validates the operations together with everything submitted before and answers saved, held or rejected.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'What these operations add, in one sentence.' },
      operations: { type: 'array', description: 'Operations in the final response schema shapes: set_title, add_entity, replace_entity, remove_entity, add_relation, remove_relation.', items: { type: 'object' } },
    },
    required: ['message', 'operations'],
    additionalProperties: false,
  },
} as const;
export const TOOL_CHECKPOINT_INSTRUCTIONS = 'Incremental output: as soon as a self-contained result is ready (one paper with its facts and sources, or about 5–10 operations), call submit_patch with a short message and those operations, in the operation shapes of the final response schema. Include what they refer to in the same or an earlier submission: no dangling references. Keep new IDs stable and unique. The tool answers saved; held (well formed but not valid yet, for example a reference to something not submitted: it is kept and validated again with your later submissions, so submit what it is missing or a corrected replace_entity); or rejected (nothing saved: fix the listed errors and submit again). A submission is not a Commit. To change an entity already in the survey or already submitted, submit a replace_entity with only its id, type and the keys you change: the server copies its other stored keys unchanged. Send such changes with submit_patch, not in the final response, which must carry every key. The final response contains only operations not submitted (usually none), plus message and follow_ups. Do not repeat submitted operations. If submit_patch is unavailable, return the complete Patch in the final response.';
export function checkpointInstructions(transport: CodexTransport) { return transport === 'exec' ? CHECKPOINT_INSTRUCTIONS : TOOL_CHECKPOINT_INSTRUCTIONS; }
/** What submit_patch answers the model. */
export function submitReply(result: { status: 'saved' | 'held' | 'rejected' | 'stopped'; error?: string; operations: number }) {
  if (result.status === 'saved') return `saved: ${result.operations} operations saved so far.`;
  if (result.status === 'held') return `held, not saved yet: ${result.error ?? 'it does not validate yet'}\nIt is kept and validated again with your later submissions and the final response. Submit what it refers to, or a corrected replace_entity.`;
  if (result.status === 'rejected') return `rejected, nothing saved: ${result.error ?? 'invalid operations'}\nFix these errors and submit again.`;
  return 'stopped: the run has ended; do not submit more.';
}
/** Sent into the running turn at the research deadline (app-server). A step without the tool only has its final response. */
export function deadlineSteer(tool: boolean) {
  return tool
    ? 'Server message: the research deadline has been reached. Stop searching and opening pages now. Submit with submit_patch whatever you have not submitted yet, then return the final response at once: message (what is covered and what is missing) and follow_ups, with operations empty unless submit_patch failed.'
    : 'Server message: the research deadline has been reached. Stop searching and opening pages now and return the final response at once with what you have collected, describing any missing coverage in message.';
}
