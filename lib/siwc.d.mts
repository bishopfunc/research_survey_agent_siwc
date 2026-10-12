// Types for siwc.mjs, so TypeScript callers (the VPS gate, design 0032) are checked.
export interface SiwcAccount { client_id: string; subject: string; id_token?: string }
export interface SiwcTransaction { state: string; nonce: string; verifier: string; redirectUri: string; expires: number; account?: SiwcAccount; used?: boolean }
export interface SiwcLogin { client_id: string; subject: string; email: string; access_token: string; refresh_token?: string; id_token?: string; scopes: string[]; expires_at: number }
export type SiwcVerify = (token: string, clientId: string, nonce?: string) => Promise<{ sub: string; email?: string }>;
export const ISSUER: string;
export const RESOURCE: string;
export const PERMISSION: string;
export function beginLogin(hostId: string, redirectUri: string, account?: SiwcAccount): { transaction: SiwcTransaction; url: URL };
export function completeLogin(params: URLSearchParams, tx: SiwcTransaction, fetchImpl?: typeof fetch, verify?: SiwcVerify): Promise<SiwcLogin>;
export function verifyIdentity(token: string, clientId: string, nonce?: string): Promise<{ sub: string; email?: string }>;
export function usableAccount<T extends SiwcLogin>(account: T, fetchImpl?: typeof fetch, verify?: SiwcVerify): Promise<T>;
