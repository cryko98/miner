// Wallet login: the client signs a server-issued nonce with its Solana key,
// we verify the ed25519 signature and hand back a stateless HMAC token.

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from './store.js';
import { KEYS } from './epoch.js';

const TOKEN_TTL_SEC = 24 * 3600;
const NONCE_TTL_SEC = 300;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.VERCEL_ENV === 'production') throw new Error('AUTH_SECRET is not set');
  return 'dev-secret-do-not-use-in-prod';
}

export function isValidWallet(w: unknown): w is string {
  if (typeof w !== 'string' || w.length < 32 || w.length > 44) return false;
  try {
    return bs58.decode(w).length === 32;
  } catch {
    return false;
  }
}

export function loginMessage(wallet: string, nonce: string): string {
  return `Gold Miner ($MINER) login\n\nWallet: ${wallet}\nNonce: ${nonce}\n\nThis signature only proves wallet ownership. It costs nothing and triggers no transaction.`;
}

export async function issueNonce(wallet: string): Promise<string> {
  const nonce = randomBytes(16).toString('hex');
  await getStore().set(KEYS.nonce(wallet), nonce, NONCE_TTL_SEC);
  return nonce;
}

export async function verifyLogin(wallet: string, signatureB58: string): Promise<string | null> {
  const store = getStore();
  const nonce = await store.get<string>(KEYS.nonce(wallet));
  if (!nonce) return null;
  let sig: Uint8Array;
  try {
    sig = bs58.decode(signatureB58);
  } catch {
    return null;
  }
  const msg = new TextEncoder().encode(loginMessage(wallet, nonce));
  const ok = sig.length === 64 && nacl.sign.detached.verify(msg, sig, bs58.decode(wallet));
  if (!ok) return null;
  await store.del(KEYS.nonce(wallet)); // single use
  return signToken(wallet);
}

function hmac(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function signToken(wallet: string): string {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  const payload = `${wallet}.${exp}`;
  return `${payload}.${hmac(payload)}`;
}

/** Returns the wallet address if the token is valid, otherwise null. */
export function verifyToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [wallet, expStr, mac] = parts;
  const expected = hmac(`${wallet}.${expStr}`);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  if (Number(expStr) < Date.now() / 1000) return null;
  if (!isValidWallet(wallet)) return null;
  return wallet;
}
