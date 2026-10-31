import type { ClusterInfo, NodeRow, Vector, ChangeVector } from './types.ts';
import type { NodeRecord } from './graph.ts';

interface EdgeSummary { source: string; target: string; rel: string }

export function buildChangeVector(
  start: NodeRow,
  clusters: ClusterInfo[],
  edges: EdgeSummary[],
  records: Map<string, NodeRecord>
): ChangeVector {
  // 1. Identify all active vectors from clusters and present node types
  const vectorSet = new Set<Vector>();
  for (const c of clusters) {
    for (const v of c.vectors) vectorSet.add(v);
  }

  for (const r of records.values()) {
    if (r.type === 'domain') vectorSet.add('web');
    if (r.type === 'wallet') vectorSet.add('crypto');
    if (r.type === 'apk') vectorSet.add('mobile');
    if (r.type === 'email') vectorSet.add('email');
    if (r.type === 'phone') vectorSet.add('telecom');
  }

  const activeVectors = [...vectorSet].sort();

  // 2. Detect vector transitions across relationship edges
  const transitions = new Set<string>();
  for (const e of edges) {
    const srcType = records.get(e.source)?.type || e.source.split(':')[0];
    const dstType = records.get(e.target)?.type || e.target.split(':')[0];

    if ((srcType === 'phone' && dstType === 'domain') || (srcType === 'domain' && dstType === 'phone')) {
      transitions.add('Telecom (SMS / Call) ➔ Web (Phishing Portal)');
    }
    if ((srcType === 'email' && dstType === 'domain') || (srcType === 'domain' && dstType === 'email')) {
      transitions.add('Email (Spearphishing Lead) ➔ Web (Infrastructure Host)');
    }
    if (e.rel === 'distributed_from' || (srcType === 'domain' && dstType === 'apk') || (srcType === 'apk' && dstType === 'domain')) {
      transitions.add('Web (Delivery Domain) ➔ Mobile (Android APK / Trojan)');
    }
    if (e.rel === 'embeds_wallet' || (srcType === 'apk' && dstType === 'wallet')) {
      transitions.add('Mobile (Malware) ➔ Crypto (Exfiltration Wallet)');
    }
    if (e.rel === 'solicits' || (srcType === 'domain' && dstType === 'wallet')) {
      transitions.add('Web (Scam Portal) ➔ Crypto (Extortion / Solicit Wallet)');
    }
    if (e.rel === 'co_spent' || e.rel === 'funded_by') {
      transitions.add('Crypto ➔ Crypto (Multi-Hop Wallet Laundering)');
    }
  }

  // 3. Calculate infrastructure churn metrics
  let ipMigrations = 0;
  let certChanges = 0;
  let nameserverRotations = 0;
  let historicalReports = 0;
  let lookalikeDomains = 0;

  for (const r of records.values()) {
    if (r.type === 'ip') ipMigrations++;
    if (r.type === 'cert') certChanges++;
    if (r.type === 'nameserver') nameserverRotations++;
    if (r.type === 'report') historicalReports++;
    if (r.type === 'brand') lookalikeDomains++;
  }

  // 4. Construct human-readable summary
  const vecNames = activeVectors.map((v) => {
    switch (v) {
      case 'web': return 'Web';
      case 'mobile': return 'Mobile Apps';
      case 'crypto': return 'Crypto Wallets';
      case 'email': return 'Email';
      case 'telecom': return 'Telecom / SMS';
    }
  });

  const vectorDesc = vecNames.length > 1
    ? `Multi-vector campaign spanning ${vecNames.join(', ')}.`
    : `Single-vector footprint centered on ${vecNames[0] || 'Web'}.`;

  const churnDetails: string[] = [];
  if (certChanges > 1) churnDetails.push(`${certChanges} SSL certificate rotations`);
  if (ipMigrations > 1) churnDetails.push(`${ipMigrations} hosting server migrations`);
  if (nameserverRotations > 1) churnDetails.push(`${nameserverRotations} DNS nameserver changes`);
  if (historicalReports > 0) churnDetails.push(`${historicalReports} external threat intelligence reports`);

  const churnDesc = churnDetails.length > 0
    ? `Infrastructure churn detected: ${churnDetails.join(', ')}.`
    : 'No rapid infrastructure rotation detected.';

  const summary = `${vectorDesc} ${churnDesc}`;

  return {
    activeVectors,
    vectorTransitions: [...transitions],
    churn: {
      ipMigrations,
      certChanges,
      historicalReports,
      lookalikeDomains,
      nameserverRotations,
    },
    summary,
  };
}
