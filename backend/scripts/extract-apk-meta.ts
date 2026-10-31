// Turns a LOCAL .apk file (from a research repository such as AndroZoo) into an observation JSON.
// Needs Android build-tools (`aapt`, `apksigner`) on PATH. The APK is only analysed offline -- never installed or run.
// Usage: npm run extract-apk -- app.apk [--hosted-on bad.example] [--wallet bc1q...]
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Observation } from '../src/domain/types.ts';

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error('Usage: npm run extract-apk -- app.apk [--hosted-on domain] [--wallet addr]'); process.exit(1); }
const flag = (name: string): string[] => rest.flatMap((v, i) => (v === name && rest[i + 1] ? [rest[i + 1] as string] : []));

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (cmd: string, args: string[]): string => {
  try { return execFileSync(cmd, args, { encoding: 'utf8' }); } catch { console.error(`warning: could not run ${cmd}`); return ''; }
};
const pkg = run('aapt', ['dump', 'badging', file]).match(/package: name='([^']+)'/)?.[1];
const signer = run('apksigner', ['verify', '--print-certs', file]).match(/certificate SHA-256 digest: ([0-9a-f]+)/i)?.[1];
const obs: Observation = { source: 'apk-file', apk: { sha256, package: pkg, signer_sha256: signer, hosted_on: flag('--hosted-on'), wallets: flag('--wallet') } };
console.log(JSON.stringify(obs, null, 2));
