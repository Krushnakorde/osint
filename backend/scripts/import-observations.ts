// Usage: npm run import -- path/to/observations.json   (a JSON object or array of observations)
import fs from 'node:fs';
import type { Observation } from '../src/domain/types.ts';
import { boot } from './_context.ts';

const file = process.argv[2];
if (!file) { console.error('Usage: npm run import -- observations.json'); process.exit(1); }
const list = ([] as Observation[]).concat(JSON.parse(fs.readFileSync(file, 'utf8')) as Observation | Observation[]);
const { services, close } = await boot();
await services.ingest.ingestMany(list.map((o) => ({ source: 'import', ...o })));
console.log(`Imported ${list.length} observations.`, await services.correlation.run());
await close();
