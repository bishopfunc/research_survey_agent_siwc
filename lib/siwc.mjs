import { randomBytes, createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const PERMISSION = 'chatgpt.tokens.use.direct';
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const random = () => randomBytes(32).toString('base64url');
export function beginLogin(hostId, redirectUri, account) {
  const transaction = { state: random(), nonce: random(), verifier: random(), redirectUri,
    expires: Date.now() + 10 * 60_000, account };
  const url = new URL(`${ISSUER}/api/accounts/authorize`);
  url.search = new URLSearchParams({ client_id: account?.client_id ?? 'dynamic_agent_client',
    ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirectUri,
    scope: `openid profile email offline_access resource.invoke ${PERMISSION}`, resource: RESOURCE,
    state: transaction.state, nonce: transaction.nonce, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(transaction.verifier).digest('base64url') });
  if (account?.id_token) url.searchParams.set('id_token_hint', account.id_token);
  if (!account) url.searchParams.set('agent_name_hint', 'Survey SIWC Probe');
  return { transaction, url };
}
async function tokenRequest(body, fetchImpl) {
  const response = await fetchImpl(`${ISSUER}/api/accounts/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body), signal: AbortSignal.timeout(30_000), redirect: 'error' });
  // status lets a caller tell a rejected grant (400/401) from a passing outage (429/5xx).
  if (!response.ok) throw Object.assign(Error(`トークン取得に失敗しました (HTTP ${response.status})。再ログインしてください。`), { status: response.status });
  const token = await response.json();
  if (typeof token.access_token !== 'string' || !token.access_token ||
      token.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(token.expires_in) || token.expires_in <= 0)
    throw Error('トークン応答が不正です。');
  return token;
}
export async function verifyIdentity(token, clientId, nonce, key = jwks) {
  const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: clientId,
    requiredClaims: ['sub', 'exp', 'iat', ...(nonce ? ['nonce'] : [])] });
  if (!payload.sub || (nonce && payload.nonce !== nonce)) throw Error('本人確認に失敗しました。');
  return payload;
}
export async function completeLogin(params, tx, fetchImpl = fetch, verify = verifyIdentity) {
  if (tx.used || Date.now() > tx.expires || params.getAll('state').length !== 1 || params.get('state') !== tx.state)
    throw Error('認可の状態が一致しないか、有効期限が切れています。');
  tx.used = true;
  if (params.has('error')) throw Error('ログインまたは利用許可が完了しませんでした。');
  const clientId = params.get('client_id') ?? tx.account?.client_id;
  if (!clientId || clientId === 'dynamic_agent_client' || (tx.account && clientId !== tx.account.client_id) || !params.get('code'))
    throw Error('アプリの登録情報が一致しません。');
  const token = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId,
    code: params.get('code'), code_verifier: tx.verifier, redirect_uri: tx.redirectUri, resource: RESOURCE }, fetchImpl);
  const identity = await verify(token.id_token, clientId, tx.nonce);
  if (tx.account && identity.sub !== tx.account.subject) throw Error('選択したアカウントと一致しません。');
  return { client_id: clientId, subject: identity.sub, email: identity.email ?? '',
    access_token: token.access_token, refresh_token: token.refresh_token, id_token: token.id_token,
    scopes: (token.scope ?? '').split(' ').filter(Boolean), expires_at: Date.now() + token.expires_in * 1000 };
}
// minValidMs: refresh unless the access token stays valid at least this long (a run cannot renew it midway).
export async function usableAccount(account, fetchImpl = fetch, verify = verifyIdentity, minValidMs = 60_000) {
  if (!account?.access_token) throw Error('先に npm run siwc:login を実行してください。');
  if (account.expires_at > Date.now() + minValidMs) return account;
  if (!account.refresh_token) throw Object.assign(Error('再ログインが必要です。'), { code: 'NO_REFRESH_TOKEN' });
  const token = await tokenRequest({ grant_type: 'refresh_token', client_id: account.client_id,
    refresh_token: account.refresh_token, resource: RESOURCE }, fetchImpl);
  if (token.id_token) {
    // The old refresh token is spent once the endpoint answered, so a JWKS outage must not lose the new one;
    // only an ID token that names another account is refused.
    const identity = await verify(token.id_token, account.client_id).catch(() => null);
    if (identity && identity.sub !== account.subject) throw Object.assign(Error('更新後の本人情報が一致しません。'), { code: 'SUBJECT_MISMATCH' });
  }
  return { ...account, access_token: token.access_token,
    refresh_token: token.refresh_token ?? account.refresh_token, id_token: token.id_token ?? account.id_token,
    scopes: token.scope === undefined ? account.scopes : token.scope.split(' ').filter(Boolean),
    expires_at: Date.now() + token.expires_in * 1000 };
}
