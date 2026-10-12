/** Lines of an algorithm from the arXiv HTML version carry no indentation, so nesting is rebuilt from the pseudocode
 * keywords: a block opens after for / while / repeat / procedure / function and after an if line that ends with then,
 * and closes at end / until; else sits one level up. The ▷ comment is split off. */
export interface AlgorithmLine { depth: number; text: string; comment: string | null }

const words = (text: string) => text.replace(/\$[^$]*\$/g, ' x ').trim().toLowerCase();
export function algorithmLines(lines: string[]): AlgorithmLine[] {
  let depth = 0;
  return lines.map(raw => {
    const [code, ...rest] = raw.split(/\s*\$\\triangleright\$\s*|\s*▷\s*/);
    const plain = words(code);
    if (/^(end|until)\b/.test(plain)) depth = Math.max(0, depth - 1);
    const at = /^else\b/.test(plain) ? Math.max(0, depth - 1) : depth;
    if (/^(for|while|repeat|loop|procedure|function)\b/.test(plain) || (/^if\b/.test(plain) && /\bthen$/.test(plain))) depth++;
    return { depth: at, text: code.trim(), comment: rest.length ? rest.join(' ▷ ').trim() || null : null };
  });
}
/** Pseudocode keywords set in bold outside math. */
export const ALGORITHM_KEYWORD = /\b(for|each|do|while|repeat|until|loop|if|then|else|end|return|procedure|function|continue|break|and|or|not|in)\b/;
