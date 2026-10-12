import test from 'node:test';
import assert from 'node:assert/strict';
import { algorithmLines } from '../apps/web/src/algorithm-layout';

test('algorithm nesting is rebuilt from the keywords and the ▷ comment is split off', () => {
  const lines = algorithmLines([
    'sort $A$ in decreasing order of priorities $p_{i}$',
    'for $a_{i}\\in A$ do',
    'if $\\pi_{i}[t+1]=\\bot$ then $\\mathsf{PIBT}(a_{i},\\bot)$',
    'end for',
    'procedure $\\mathsf{PIBT}$ ( $a_{i}$ , $a_{j}$ ) $\\triangleright$ we use $t$ implicitly',
    'for $v\\in C$ do',
    'if $\\exists a_{k}$ s.t. $\\pi_{k}[t]=v$ then',
    'if $\\mathsf{PIBT}(a_{k},a_{i})$ is invalid then continue $\\triangleright$ replanning',
    'else',
    'return valid',
    'end if',
    'end for',
    'return invalid',
    'end procedure',
  ]);
  assert.deepEqual(lines.map(l => l.depth), [0, 0, 1, 0, 0, 1, 2, 3, 2, 3, 2, 1, 1, 0]);
  assert.equal(lines[4].comment, 'we use $t$ implicitly');
  assert.equal(lines[4].text, 'procedure $\\mathsf{PIBT}$ ( $a_{i}$ , $a_{j}$ )');
  assert.equal(lines[2].comment, null);
});
test('stray end lines never indent below zero', () => {
  assert.deepEqual(algorithmLines(['end', 'end for', 'x']).map(l => l.depth), [0, 0, 0]);
});
