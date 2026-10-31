import fs from 'node:fs';
import { config } from '../config.ts';
import type { Brand } from '../domain/types.ts';

/** data/brands.json (~95 brands) plus any names in EXTRA_BRANDS. Add more freely: it is just a JSON file. */
export function loadBrands(): Brand[] {
  const base = JSON.parse(fs.readFileSync(config.brandsFile, 'utf8')) as Brand[];
  const known = new Set(base.map((b) => b.name));
  return [...base, ...config.extraBrands.filter((n) => !known.has(n)).map((name): Brand => ({ name, domains: [] }))];
}

/** One domain per line; lines starting with # are comments. */
export function loadBenignDomains(): string[] {
  if (!fs.existsSync(config.benignFile)) return [];
  return fs.readFileSync(config.benignFile, 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'));
}
