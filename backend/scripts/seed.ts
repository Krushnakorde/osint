// OPTIONAL: fills the configured database with a small SYNTHETIC demo dataset. The system works without it.
import { generateDataset } from '../src/domain/synthetic.ts';
import { boot } from './_context.ts';

const { services, close } = await boot();
const { observations } = generateDataset({ campaigns: 12, noise: 30, seed: 7 });
await services.ingest.ingestMany(observations);
console.log(`Seeded ${observations.length} synthetic observations.`, await services.correlation.run());
console.log(`Try searching for: ${(await services.graph.recentNodes('domain', 1))[0]?.value}`);
await close();
