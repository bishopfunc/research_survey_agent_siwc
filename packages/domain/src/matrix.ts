import type { SurveySnapshot } from './index';
import { byPublication } from './evolution';
export function buildIssueMethodMatrix(snapshot: SurveySnapshot, search='') {
  const issues=snapshot.entities.filter(e=>e.type==='Issue');
  const methods=snapshot.entities.filter(e=>e.type==='Method');
  const papers=snapshot.entities.filter(e=>e.type==='Paper');
  const related=(from:string,to:string,type:string)=>snapshot.relations.some(r=>r.type===type&&r.from===from&&r.to===to);
  const cells=issues.flatMap(issue=>methods.map(method=>{
    const linked=papers.filter(p=>(p.proposes.includes(method.id)||related(p.id,method.id,'proposes'))&&(p.addresses.includes(issue.id)||related(p.id,issue.id,'addresses'))).sort(byPublication);
    return {issue,method,papers:linked,recorded:linked.length>0||related(method.id,issue.id,'addresses')};
  }));
  const query=search.trim().toLocaleLowerCase();
  const matches=(text:string)=>text.toLocaleLowerCase().includes(query);
  const shown=issues.filter(issue=>!query||matches(`${issue.label} ${issue.description}`)||cells.some(c=>c.issue.id===issue.id&&c.recorded&&(matches(`${c.method.label} ${c.method.description}`)||c.papers.some(p=>matches(p.title)))));
  return {issues:shown,methods,cells};
}
