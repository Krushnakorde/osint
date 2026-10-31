import { getJson } from '../net-guard.ts';
import type { WalletLinkObj } from '../../domain/types.ts';
import type { Collector } from './types.ts';

interface MempoolAddr { chain_stats?: { tx_count?: number }; mempool_stats?: { tx_count?: number } }
interface MempoolTx { vin?: Array<{ prevout?: { scriptpubkey_address?: string } }> }

/**
 * Bitcoin public ledger via mempool.space.
 * Common-input-ownership heuristic: addresses spent together as inputs of one transaction
 * are assumed to belong to the same entity (known weak spot: CoinJoin).
 */
export const btc: Collector = {
  name: 'mempool.space', kinds: ['btc'],
  async run({ value }) {
    const info = await getJson<MempoolAddr>(`https://mempool.space/api/address/${value}`);
    const txCount = (info.chain_stats?.tx_count ?? 0) + (info.mempool_stats?.tx_count ?? 0);
    if (!txCount) return { exists: false, note: 'address has no transactions' };
    const txs = await getJson<MempoolTx[]>(`https://mempool.space/api/address/${value}/txs`);
    const co = new Set<string>();
    for (const tx of txs.slice(0, 25)) {
      const ins = [...new Set((tx.vin ?? []).map((v) => v.prevout?.scriptpubkey_address).filter((x): x is string => !!x))];
      if (ins.includes(value)) for (const o of ins) if (o !== value) co.add(o);
    }
    const links: WalletLinkObj[] = [...co].slice(0, 20).map((b) => ({ a: value, b, rel: 'co_spent', weight: 1 }));
    return { obs: { wallets: [value], wallet_links: links }, exists: true, note: `${txCount} transaction(s) on-chain` };
  },
};

interface BsAddr { hash?: string; is_contract?: boolean }
interface BsTx { from?: { hash?: string; is_contract?: boolean }; to?: { hash?: string } }

/** Ethereum via Blockscout's public API: wallets that funded this one are weak evidence (weight 0.5). */
export const eth: Collector = {
  name: 'blockscout', kinds: ['eth'],
  async run({ value }) {
    const a = await getJson<BsAddr>(`https://eth.blockscout.com/api/v2/addresses/${value}`);
    if (!a.hash) return { exists: false };
    const tx = await getJson<{ items?: BsTx[] }>(`https://eth.blockscout.com/api/v2/addresses/${value}/transactions`);
    const funders = new Set<string>();
    for (const t of tx.items ?? []) {
      if (t.to?.hash?.toLowerCase() === value && t.from?.hash && !t.from.is_contract) funders.add(t.from.hash.toLowerCase());
    }
    const links: WalletLinkObj[] = [...funders].slice(0, 10).map((b) => ({ a: value, b, rel: 'funded_by', weight: 0.5 }));
    return { obs: { wallets: [value], wallet_links: links }, exists: true, note: a.is_contract ? 'address is a contract' : undefined };
  },
};
