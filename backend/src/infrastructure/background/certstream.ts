import { detectBrand } from '../../domain/typosquat.ts';
import { isAllowedUrl } from '../net-guard.ts';
import type { Config } from '../../config.ts';
import type { IngestService } from '../../application/IngestService.ts';
import type { Brand, Observation } from '../../domain/types.ts';

export const certstreamStatus = { enabled: false, connected: false, seen: 0, matched: 0, lastMatch: '' };

interface CertUpdate { message_type?: string; data?: { leaf_cert?: { all_domains?: string[]; sha256?: string; fingerprint?: string; serial_number?: string } } }

/** Turns one raw certstream message into observations for domains that look like a known brand. */
export function matchCertUpdate(raw: string, brands: Brand[]): Observation[] {
  let msg: CertUpdate;
  try { msg = JSON.parse(raw) as CertUpdate; } catch { return []; }
  if (msg.message_type !== 'certificate_update') return [];
  const leaf = msg.data?.leaf_cert;
  const domains = (leaf?.all_domains ?? []).map((d) => d.toLowerCase().replace(/^\*\./, ''));
  certstreamStatus.seen++;
  const certId = leaf?.sha256 ?? leaf?.fingerprint ?? leaf?.serial_number;
  const out: Observation[] = [];
  for (const d of new Set(domains)) {
    if (!detectBrand(d, brands)) continue;
    out.push({ source: 'certstream', domain: d, certs: certId ? [certId] : undefined, sans: domains.filter((x) => x !== d).slice(0, 20) });
  }
  return out;
}

/**
 * REAL-TIME discovery: listens to the public Certificate Transparency firehose and stores every newly
 * issued certificate whose domain imitates one of our brands. Batches writes; re-correlates at most once a minute.
 */
export function startCertstream(ingest: IngestService, cfg: Config, brands: Brand[], onChange: () => void): () => void {
  if (!isAllowedUrl(cfg.certstreamUrl)) throw new Error(`CERTSTREAM_URL host is not on the passive allow-list: ${cfg.certstreamUrl}`);
  certstreamStatus.enabled = true;
  const seen = new Set<string>(); const queue: Observation[] = [];
  let ws: WebSocket | null = null; let stopped = false; let backoff = 2000; let dirty = false;

  const connect = (): void => {
    if (stopped) return;
    ws = new WebSocket(cfg.certstreamUrl);
    ws.onopen = () => { certstreamStatus.connected = true; backoff = 2000; };
    ws.onmessage = (ev) => {
      for (const o of matchCertUpdate(String(ev.data), brands)) {
        if (!o.domain || seen.has(o.domain)) continue;
        if (seen.size > 100_000) seen.clear();
        seen.add(o.domain); queue.push(o);
        certstreamStatus.matched++; certstreamStatus.lastMatch = o.domain;
      }
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => {
      certstreamStatus.connected = false;
      if (!stopped) { setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60_000); }
    };
  };
  connect();
  const flush = setInterval(() => { if (queue.length) { dirty = true; ingest.ingestMany(queue.splice(0)).catch((e: Error) => console.warn(`[certstream] ${e.message}`)); } }, 5000);
  const correlate = setInterval(() => { if (dirty) { dirty = false; onChange(); } }, 60_000);
  return () => { stopped = true; clearInterval(flush); clearInterval(correlate); ws?.close(); certstreamStatus.connected = false; };
}
