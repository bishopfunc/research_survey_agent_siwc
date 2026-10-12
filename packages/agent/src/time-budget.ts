/** Shared by the runner and Lab. A soft research deadline reserves time for serialization. */
export const BUDGET_PROMPT_VERSION = 'survey-budget@2026-10-12T23:24+09:00';
export const STOP_GRACE_MS = 5_000;
export function timeBudget(totalSeconds: number, writeSeconds = Math.min(180, Math.max(30, Math.floor(totalSeconds * 0.4)))) {
  const writing = Math.min(writeSeconds, Math.floor(totalSeconds / 2));
  return { totalSeconds, researchSeconds: totalSeconds - writing, writeSeconds: writing };
}
export function budgetInstructions(totalSeconds: number, startedAt: number, writeSeconds?: number) {
  const b = timeBudget(totalSeconds, writeSeconds);
  const at = (seconds: number) => new Date(startedAt + seconds * 1000).toISOString();
  return `Execution budget: ${b.totalSeconds} seconds total. Research deadline: ${at(b.researchSeconds)} (${b.researchSeconds} seconds from start). Hard stop: ${at(b.totalSeconds)}. Reserve the final ${b.writeSeconds} seconds for writing the structured result. Use the current time available in code mode to check the deadline between tool calls. Stop new searches and reading at the research deadline, use only information already collected, finish the JSON and describe any missing coverage in message. Never invent facts to fill gaps. If writing will take longer, stop research earlier. The server terminates this process at the hard stop; a prompt deadline is not an extension.`;
}
export const CHECKPOINT_INSTRUCTIONS = 'Incremental output (this mode explicitly permits commentary checkpoints as an exception to the schema-only output rule; the final response still conforms to the supplied schema): as soon as a self-contained result is ready (one paper with its facts and sources, or about 5–10 operations), send a commentary message consisting of SURVEY_CHECKPOINT followed by one complete JSON Patch with schema_version, base_commit_id, message, operations. Include dependencies in the same or an earlier checkpoint: no dangling references. Keep new IDs stable and unique. Do not send incomplete JSON or markdown fences. The server validates and saves each completed checkpoint; it is not a Commit. The final schema-constrained response is a Patch containing only the operations not already sent, plus the final message and follow_ups; operations may be empty if everything was checkpointed. Do not repeat earlier operations unless correcting them. If commentary is unavailable, return the complete Patch in the final response.';
