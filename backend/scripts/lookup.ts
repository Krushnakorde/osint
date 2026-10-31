// Live lookup from the command line: the quickest way to check that the public sources work from YOUR network.
// Usage: npm run lookup -- evil-example.com     (domain, IP, bitcoin/ethereum address, URL or 64-hex hash)
import { boot } from './_context.ts';

const q = process.argv[2];
if (!q) { console.error('Usage: npm run lookup -- <indicator>'); process.exit(1); }
const { services, close } = await boot();
const r = await services.live.lookup(q);
console.log(`Detected: ${r.kind}   stored in database: ${r.stored}   observations: ${r.observations}`);
for (const s of r.sources) console.log(`  ${s.ok ? (s.found ? 'FOUND ' : 'empty ') : 'FAILED'} ${s.source.padEnd(22)} ${String(s.ms).padStart(5)} ms  ${s.note ?? ''}`);
if (r.stored) {
  await services.correlation.run();
  const inv = await services.investigation.investigate(q);
  if (inv.found) console.log(`Verdict: ${inv.assessment.level} (${inv.assessment.score ?? '-'} points); graph: ${inv.graph.nodes.length} nodes, ${inv.graph.links.length} links`);
}
await close();
