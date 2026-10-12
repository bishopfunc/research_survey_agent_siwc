import fixtureJSON from './fixture.json';
import type { Paper, SurveySnapshot, Tutorial, TutorialSection } from './snapshot.types';
import { citationsIn, sectionCitations, TUTORIAL_ROLE_LABELS, TUTORIAL_ROLES, tutorialOutline } from './tutorial';

/** The sample tutorial (MAPF入門) is the reference every tutorial is written and compared against (user instruction). */
export interface TutorialProfile { sections: Record<TutorialSection['role'], number>; chars: number; figures: number; media: number; citedPapers: number; citedClaims: number; openQuestions: number }
const tutorialOf = (snapshot: SurveySnapshot) => snapshot.entities.find((e): e is Tutorial => e.type === 'Tutorial');

export function tutorialProfile(snapshot: SurveySnapshot): TutorialProfile | null {
  const tutorial = tutorialOf(snapshot);
  if (!tutorial) return null;
  const types = new Map(snapshot.entities.map(e => [e.id, e.type]));
  const cited = new Set(tutorial.sections.flatMap(sectionCitations));
  const media = tutorial.sections.flatMap(s => s.media);
  return {
    sections: Object.fromEntries(TUTORIAL_ROLES.map(role => [role, tutorial.sections.filter(s => s.role === role).length])) as TutorialProfile['sections'],
    chars: tutorial.sections.reduce((n, s) => n + s.body.length, 0),
    figures: media.filter(m => /fig|図/i.test(m.label)).length,
    media: media.length,
    citedPapers: [...cited].filter(id => types.get(id) === 'Paper').length,
    citedClaims: [...cited].filter(id => types.get(id) === 'Claim').length,
    openQuestions: tutorial.sections.reduce((n, s) => n + s.body.split('\n').filter(l => /^\s*[-・]\s+.*[？?]\s*$/.test(l)).length, 0),
  };
}

const reference = fixtureJSON as unknown as SurveySnapshot;
export const REFERENCE_TUTORIAL = tutorialOf(reference)!;
export const REFERENCE_PROFILE = tutorialProfile(reference)!;

/** A tutorial measured against the reference: each row is a value, the reference value and their ratio. */
export function compareToReference(snapshot: SurveySnapshot) {
  const profile = tutorialProfile(snapshot);
  const rows: [string, string, (p: TutorialProfile) => number][] = [
    ['methods', '解き方の節', p => p.sections.methods], ['challenges', '課題と達成度の節', p => p.sections.challenges], ['variants', '派生問題の節', p => p.sections.variants],
    ['chars', '本文の字数', p => p.chars], ['figures', '論文の図', p => p.figures], ['papers', '引用した論文', p => p.citedPapers], ['claims', '引用した達成度の主張', p => p.citedClaims], ['questions', '未解決の問い', p => p.openQuestions],
  ];
  return rows.map(([id, label, value]) => { const v = profile ? value(profile) : 0, r = value(REFERENCE_PROFILE); return { id, label, value: v, reference: r, ratio: r ? v / r : 1 }; });
}

/** The reference's outline and scale for the prompt: what to write, not the MAPF content. */
export function referenceOutline(): string {
  const chapters = tutorialOutline(REFERENCE_TUTORIAL.sections).map(c => `${c.number} ${c.title} (${c.role}${c.sections.length > 1 ? `, ${c.sections.length} sections: ${c.sections.map(s => `${s.number} ${s.heading}`).join(' / ')}` : ''})`);
  const papers = new Map(reference.entities.filter((e): e is Paper => e.type === 'Paper').map(p => [p.id, p]));
  const challenge = REFERENCE_TUTORIAL.sections.find(s => s.role === 'challenges' && /[？?]\s*$/m.test(s.body)) ?? REFERENCE_TUTORIAL.sections.find(s => s.role === 'challenges');
  const p = REFERENCE_PROFILE;
  return [
    `Reference tutorial (the app's MAPF sample "${REFERENCE_TUTORIAL.label}"): write to its structure and depth, adapting the content to this field. Its outline: ${chapters.join('; ')}.`,
    `Its scale: ${p.sections.methods} methods sections, ${p.sections.challenges} challenges sections, ${p.sections.variants} variants sections, about ${Math.round(p.chars / 100) * 100} characters, ${p.figures} paper figures and ${p.media} media in all, ${p.citedPapers} papers and ${p.citedClaims} achievement claims cited, ${p.openQuestions} open questions. Smaller fields may need fewer sections, but keep every role and the same kind of content in each.`,
    challenge ? `One challenges section of the reference, as an example of form only (do not copy its content): ${JSON.stringify(challenge.heading)} — ${JSON.stringify(challenge.body.replace(/\[@([^\]\s]+)\]/g, (_, id) => papers.has(id) ? '[@paper]' : '[@id]'))}` : '',
  ].filter(Boolean).join(' ');
}
export { citationsIn, TUTORIAL_ROLE_LABELS };
