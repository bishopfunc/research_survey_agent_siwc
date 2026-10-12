/** Acronyms of well-known venues, prepared in advance so the venue is fixed information rather than an LLM guess.
 * Each entry matches OpenAlex source names (and common spellings) after normalization. Order matters: more specific
 * phrases come before shorter ones they contain (e.g. "robotics and automation letters" before "robotics and automation"). */
export interface Venue { acronym: string; type: 'conference' | 'journal' | 'preprint'; match: string[] }
export const VENUES: Venue[] = [
  // Preprint servers
  { acronym: 'arXiv', type: 'preprint', match: ['arxiv'] },
  // Machine learning
  { acronym: 'NeurIPS', type: 'conference', match: ['neural information processing systems', 'neurips', 'nips'] },
  { acronym: 'ICML', type: 'conference', match: ['international conference on machine learning'] },
  { acronym: 'ICLR', type: 'conference', match: ['international conference on learning representations'] },
  { acronym: 'JMLR', type: 'journal', match: ['journal of machine learning research'] },
  { acronym: 'TMLR', type: 'journal', match: ['transactions on machine learning research'] },
  { acronym: 'AISTATS', type: 'conference', match: ['artificial intelligence and statistics'] },
  { acronym: 'UAI', type: 'conference', match: ['uncertainty in artificial intelligence'] },
  { acronym: 'COLT', type: 'conference', match: ['conference on learning theory'] },
  { acronym: 'CoRL', type: 'conference', match: ['conference on robot learning'] },
  { acronym: 'TNNLS', type: 'journal', match: ['transactions on neural networks and learning systems'] },
  // Artificial intelligence
  { acronym: 'AAAI', type: 'conference', match: ['aaai conference on artificial intelligence', 'national conference on artificial intelligence'] },
  { acronym: 'IJCAI', type: 'conference', match: ['international joint conference on artificial intelligence'] },
  { acronym: 'AAMAS', type: 'conference', match: ['autonomous agents and multiagent systems', 'autonomous agents and multi agent systems'] },
  { acronym: 'ICAPS', type: 'conference', match: ['automated planning and scheduling'] },
  { acronym: 'SoCS', type: 'conference', match: ['symposium on combinatorial search'] },
  { acronym: 'ECAI', type: 'conference', match: ['european conference on artificial intelligence'] },
  { acronym: 'KR', type: 'conference', match: ['principles of knowledge representation and reasoning'] },
  { acronym: 'AIJ', type: 'journal', match: ['artificial intelligence journal', '^artificial intelligence$'] },
  { acronym: 'JAIR', type: 'journal', match: ['journal of artificial intelligence research'] },
  { acronym: 'TPAMI', type: 'journal', match: ['transactions on pattern analysis and machine intelligence'] },
  // Computer vision
  { acronym: 'CVPR', type: 'conference', match: ['computer vision and pattern recognition'] },
  { acronym: 'ICCV', type: 'conference', match: ['international conference on computer vision'] },
  { acronym: 'ECCV', type: 'conference', match: ['european conference on computer vision'] },
  { acronym: 'WACV', type: 'conference', match: ['winter conference on applications of computer vision'] },
  { acronym: 'BMVC', type: 'conference', match: ['british machine vision conference'] },
  { acronym: '3DV', type: 'conference', match: ['international conference on 3d vision'] },
  { acronym: 'IJCV', type: 'journal', match: ['international journal of computer vision'] },
  { acronym: 'TIP', type: 'journal', match: ['transactions on image processing'] },
  // Natural language processing
  { acronym: 'TACL', type: 'journal', match: ['transactions of the association for computational linguistics'] },
  { acronym: 'NAACL', type: 'conference', match: ['north american chapter of the association for computational linguistics'] },
  { acronym: 'EACL', type: 'conference', match: ['european chapter of the association for computational linguistics'] },
  { acronym: 'EMNLP', type: 'conference', match: ['empirical methods in natural language processing'] },
  { acronym: 'COLING', type: 'conference', match: ['international conference on computational linguistics'] },
  { acronym: 'ACL', type: 'conference', match: ['annual meeting of the association for computational linguistics', 'meeting of the association for computational linguistics'] },
  { acronym: 'CoNLL', type: 'conference', match: ['computational natural language learning'] },
  // Robotics
  { acronym: 'IEEE RA-L', type: 'journal', match: ['robotics and automation letters'] },
  { acronym: 'T-RO', type: 'journal', match: ['transactions on robotics'] },
  { acronym: 'IJRR', type: 'journal', match: ['international journal of robotics research'] },
  { acronym: 'RSS', type: 'conference', match: ['robotics science and systems'] },
  { acronym: 'IROS', type: 'conference', match: ['intelligent robots and systems'] },
  { acronym: 'ICRA', type: 'conference', match: ['international conference on robotics and automation'] },
  { acronym: 'CASE', type: 'conference', match: ['automation science and engineering'] },
  { acronym: 'T-ASE', type: 'journal', match: ['transactions on automation science and engineering'] },
  { acronym: 'Auton. Robots', type: 'journal', match: ['autonomous robots'] },
  { acronym: 'Sci. Robot.', type: 'journal', match: ['science robotics'] },
  { acronym: 'HRI', type: 'conference', match: ['human robot interaction'] },
  // Data mining, information retrieval, web
  { acronym: 'KDD', type: 'conference', match: ['knowledge discovery and data mining'] },
  { acronym: 'WWW', type: 'conference', match: ['the web conference', 'world wide web conference'] },
  { acronym: 'SIGIR', type: 'conference', match: ['research and development in information retrieval'] },
  { acronym: 'WSDM', type: 'conference', match: ['web search and data mining'] },
  { acronym: 'CIKM', type: 'conference', match: ['information and knowledge management'] },
  { acronym: 'RecSys', type: 'conference', match: ['recommender systems'] },
  // Graphics, HCI, systems, theory
  { acronym: 'SIGGRAPH', type: 'conference', match: ['siggraph'] },
  { acronym: 'TOG', type: 'journal', match: ['acm transactions on graphics'] },
  { acronym: 'CHI', type: 'conference', match: ['human factors in computing systems'] },
  { acronym: 'UIST', type: 'conference', match: ['user interface software and technology'] },
  { acronym: 'OSDI', type: 'conference', match: ['operating systems design and implementation'] },
  { acronym: 'SOSP', type: 'conference', match: ['symposium on operating systems principles'] },
  { acronym: 'MLSys', type: 'conference', match: ['machine learning and systems'] },
  { acronym: 'STOC', type: 'conference', match: ['symposium on theory of computing'] },
  { acronym: 'FOCS', type: 'conference', match: ['foundations of computer science'] },
  { acronym: 'SODA', type: 'conference', match: ['symposium on discrete algorithms'] },
  // Speech, signal processing
  { acronym: 'ICASSP', type: 'conference', match: ['acoustics speech and signal processing'] },
  { acronym: 'Interspeech', type: 'conference', match: ['interspeech'] },
  // Broad journals
  { acronym: 'Nature', type: 'journal', match: ['^nature$'] },
  { acronym: 'Science', type: 'journal', match: ['^science$'] },
  { acronym: 'Nat. Mach. Intell.', type: 'journal', match: ['nature machine intelligence'] },
  { acronym: 'PNAS', type: 'journal', match: ['proceedings of the national academy of sciences'] },
  { acronym: 'CACM', type: 'journal', match: ['communications of the acm'] },
];
const norm = (name: string) => name.normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(19|20)\d\d\b/g, ' ').replace(/\s+/g, ' ').trim();
const matches = (name: string, pattern: string) => pattern.startsWith('^') ? new RegExp(pattern).test(name) : name.includes(pattern);
/** The known venue for a full name (from OpenAlex or a paper page), or null when it is not in the table. */
export function lookupVenue(name: string | null | undefined): Venue | null {
  if (!name) return null;
  const n = norm(name);
  const byAcronym = VENUES.find(v => norm(v.acronym) === n);
  return byAcronym ?? VENUES.find(v => v.match.some(p => matches(n, p))) ?? null;
}
