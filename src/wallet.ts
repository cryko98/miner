// Minimal Solana wallet connector built on the Wallet Standard (Phantom,
// Solflare, Backpack, etc. all register themselves through it). No heavy
// adapter packages needed.

import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import bs58 from 'bs58';

interface ConnectFeature {
  connect(opts?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }>;
}
interface DisconnectFeature {
  disconnect(): Promise<void>;
}
interface SignMessageFeature {
  signMessage(...inputs: { message: Uint8Array; account: WalletAccount }[]): Promise<readonly { signature: Uint8Array }[]>;
}

export interface ConnectedWallet {
  name: string;
  icon: string;
  address: string;
  signMessage(text: string): Promise<string>; // base58 signature
  disconnect(): Promise<void>;
}

export function listWallets(): Wallet[] {
  return getWallets()
    .get()
    .filter((w) => w.chains.some((c) => c.startsWith('solana:')) && 'standard:connect' in w.features && 'solana:signMessage' in w.features);
}

/** Fires when a wallet registers or unregisters (e.g. injected late by an in-app browser). */
export function onWalletsChanged(cb: () => void): void {
  const w = getWallets();
  w.on('register', cb);
  w.on('unregister', cb);
}

export async function connectWallet(w: Wallet): Promise<ConnectedWallet> {
  const connect = w.features['standard:connect'] as ConnectFeature;
  const { accounts } = await connect.connect();
  const account = accounts.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? accounts[0];
  if (!account) throw new Error('No account returned by wallet');
  const sign = w.features['solana:signMessage'] as SignMessageFeature;
  const disc = w.features['standard:disconnect'] as DisconnectFeature | undefined;
  return {
    name: w.name,
    icon: w.icon,
    address: account.address,
    async signMessage(text) {
      const [out] = await sign.signMessage({ message: new TextEncoder().encode(text), account });
      return bs58.encode(out.signature);
    },
    async disconnect() {
      await disc?.disconnect();
    },
  };
}
