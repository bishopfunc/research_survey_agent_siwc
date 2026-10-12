import { normalizeDoi, normalizeTitle } from '../scripts/paper-ids';
import type { S2Fetcher, S2Paper } from '../scripts/semantic-scholar';

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
/** A fake Semantic Scholar: the batch answers DOI:/ARXIV: IDs from a fixed list, the title match answers the closest title. */
export function semanticScholarApi(list: S2Paper[], fail?: (url: string, attempt: number) => number | null) {
  const calls: Call[] = [];
  const fetcher: S2Fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const status = fail?.(url, calls.filter(c => c.url === url).length) ?? 200;
    const answer = (code: number, value: unknown) => ({ ok: code === 200, status: code, text: async () => JSON.stringify(value) });
    if (status !== 200) return answer(status, { message: 'Too Many Requests' });
    if (url.includes('/paper/batch')) {
      const ids = (JSON.parse(init.body ?? '{}') as { ids: string[] }).ids;
      return answer(200, ids.map(id => list.find(p => id.startsWith('ARXIV:') ? p.externalIds?.ArXiv === id.slice(6) : normalizeDoi(p.externalIds?.DOI) === normalizeDoi(id.slice(4))) ?? null));
    }
    const query = new URL(url).searchParams.get('query') ?? '';
    const best = list.find(p => normalizeTitle(p.title).includes(normalizeTitle(query)) || normalizeTitle(query).includes(normalizeTitle(p.title)));
    return best ? answer(200, { data: [best] }) : answer(404, { error: 'Title match not found' });
  };
  return { fetcher, calls };
}
