// Solana RPC helpers: holder check, reward wallet balance, SOL payouts.

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

export const MIN_HOLD_TOKENS = 100_000;

let conn: Connection | undefined;
export function connection(): Connection {
  if (!conn) conn = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  return conn;
}

/** Token mint (the pump.fun contract address). Empty until launch. */
export function tokenMint(): string {
  return (process.env.TOKEN_MINT || '').trim();
}

export function rewardWalletAddress(): string {
  const explicit = (process.env.REWARD_WALLET || '').trim();
  if (explicit) return explicit;
  const kp = rewardKeypair();
  return kp ? kp.publicKey.toBase58() : '';
}

export function rewardKeypair(): Keypair | null {
  const s = (process.env.REWARD_WALLET_SECRET || '').trim();
  if (!s) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(s));
  } catch {
    return null;
  }
}

/** Sum of $MINER held by the wallet across all its token accounts (UI amount). */
export async function tokenBalance(wallet: string): Promise<number> {
  const mint = tokenMint();
  if (!mint) return 0;
  const res = await connection().getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: new PublicKey(mint) });
  let total = 0;
  for (const acc of res.value) {
    const info = acc.account.data.parsed?.info;
    total += Number(info?.tokenAmount?.uiAmount ?? 0);
  }
  return total;
}

export async function isHolder(wallet: string): Promise<{ ok: boolean; balance: number }> {
  if (!tokenMint()) return { ok: true, balance: 0 }; // pre-launch: open to everyone
  const balance = await tokenBalance(wallet);
  return { ok: balance >= MIN_HOLD_TOKENS, balance };
}

export async function rewardWalletBalanceSol(): Promise<number> {
  const addr = rewardWalletAddress();
  if (!addr) return 0;
  const lamports = await connection().getBalance(new PublicKey(addr));
  return lamports / LAMPORTS_PER_SOL;
}

export async function sendSol(to: string, sol: number): Promise<string> {
  const kp = rewardKeypair();
  if (!kp) throw new Error('REWARD_WALLET_SECRET not configured');
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: new PublicKey(to),
      lamports: Math.floor(sol * LAMPORTS_PER_SOL),
    }),
  );
  return await sendAndConfirmTransaction(connection(), tx, [kp], { commitment: 'confirmed' });
}
