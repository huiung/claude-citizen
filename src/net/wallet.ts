// Solana wallet provider access. Phantom-first, falls back to any Wallet-Standard
// provider injected on window that exposes the same signMessage shape.
import bs58 from 'bs58'
import { Transaction } from '@solana/web3.js'

interface SolanaProvider {
  isPhantom?: boolean
  publicKey?: { toBase58(): string } | null
  connect(): Promise<{ publicKey: { toBase58(): string } }>
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>
  signAndSendTransaction(transaction: Transaction): Promise<{ signature: string }>
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

/** Mobile browsers have no Phantom extension, so there's no injected provider. The fix is to open
 *  the site inside Phantom's in-app browser (which injects a provider), not to "install" anything. */
export function isMobileBrowser(): boolean {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

/** Phantom universal link that reopens the current page inside the Phantom app's in-app browser. */
export function phantomBrowseUrl(target: string = location.href): string {
  return `https://phantom.app/ul/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(location.origin)}`
}

/** Ask the wallet to sign `message`; resolves to a base58 signature. */
export async function signMessage(message: string): Promise<string> {
  const p = getProvider()
  if (!p) throw new WalletError(NO_WALLET)
  const { signature } = await p.signMessage(new TextEncoder().encode(message), 'utf8')
  return bs58.encode(signature)
}

/** Deserialize a server-built unsigned tx (base64), have the wallet sign + submit it, and
 *  resolve to the transaction signature. Phantom submits via its own RPC — no client RPC key. */
export async function signAndSendTransaction(txBase64: string): Promise<string> {
  const p = getProvider()
  if (!p) throw new WalletError(NO_WALLET)
  const bytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0))
  const tx = Transaction.from(bytes)
  const { signature } = await p.signAndSendTransaction(tx)
  return signature
}
