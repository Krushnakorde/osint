// Shared bootstrap for the command-line scripts: same wiring as the server.
import { config } from '../src/config.ts';
import { createAdapters, wire } from '../src/container.ts';

export async function boot() {
  const { adapters, close } = await createAdapters(config);
  return { services: wire(adapters, config), config, close };
}
