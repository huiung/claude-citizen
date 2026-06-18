// Solana wallet provider access. Phantom-first, falls back to any Wallet-Standard
// provider injected on window that exposes the same signMessage shape.
import bs58 from 'bs58'

interface SolanaProvider {
  isPhantom?: boolean
  publicKey?: { toBase58(): string } | null
  connect(): Promise<{ publicKey: { toBase58(): string } }>
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>
}

export class WalletError extends Error {}
export const NO_WALLET = 'NO_WALLET'

function getProvider(): SolanaProvider | null {
  const w = window as unknown as {
    phantom?: { solana?: SolanaProvider }
    solana?: SolanaProvider
  }
  if (w.phantom?.solana?.isPhantom) return w.phantom.solana
  if (w.solana?.isPhantom) return w.solana
  if (w.solana?.signMessage) return w.solana // Wallet-Standard fallback
  return null
}

export function hasWallet(): boolean {
  return getProvider() !== null
}

/** Prompt the wallet to connect; resolves to the base58 pubkey. */
export async function connectWallet(): Promise<string> {
  const p = getProvider()
  if (!p) throw new WalletError(NO_WALLET)
  const res = await p.connect()
  return res.publicKey.toBase58()
}

/** Ask the wallet to sign `message`; resolves to a base58 signature. */
export async function signMessage(message: string): Promise<string> {
  const p = getProvider()
  if (!p) throw new WalletError(NO_WALLET)
  const { signature } = await p.signMessage(new TextEncoder().encode(message), 'utf8')
  return bs58.encode(signature)
}
