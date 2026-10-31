// Connects to the configured database and creates every collection and index.
import { boot } from './_context.ts';
const { services, config, close } = await boot();
console.log(`Database ready (storage: ${config.storage}).`, await services.graph.stats());
await close();
