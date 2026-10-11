import type { Entity } from '../../../packages/domain/src/index';
export const codeAvailabilityLabels = {public:'公開あり',not_found:'見つからず',unknown:'未確認'};
export function paperCodeLabel(paper: Extract<Entity,{type:'Paper'}>) {
  return `コード ${codeAvailabilityLabels[paper.code_availability ?? 'unknown']}`;
}
