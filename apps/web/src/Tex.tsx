import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/** Macros LaTeXML pages use that KaTeX lacks. */
const macros = { '\\argmax': '\\operatorname*{arg\\,max}', '\\argmin': '\\operatorname*{arg\\,min}' };
/** TeX from a paper rendered by KaTeX. trust is off, so commands such as \href or \htmlId cannot inject markup;
 * a formula KaTeX cannot parse is shown as its source instead of failing. */
export function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = useMemo(() => katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 500, maxSize: 20, macros: { ...macros } }), [tex, display]);
  return <span className={display ? 'tex tex-display' : 'tex'} dangerouslySetInnerHTML={{ __html: html }}/>;
}
/** Plain text with inline math between $ signs (as in algorithm lines). */
export function MathText({ text }: { text: string }) {
  return <>{text.split(/\$([^$]+)\$/).map((part, i) => i % 2 ? <Tex key={i} tex={part}/> : part)}</>;
}
