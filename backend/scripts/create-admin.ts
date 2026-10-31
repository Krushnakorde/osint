// Usage: npm run create-admin -- you@example.com "a strong password" "Your Name"
import { boot } from './_context.ts';

const [email, password, name] = process.argv.slice(2);
if (!email || !password || !name) { console.error('Usage: npm run create-admin -- <email> <password> <name>'); process.exit(1); }
const { services, close } = await boot();
const r = await services.auth.register({ email, password, name });
console.log(`Created ${r.user.role} account for ${r.user.email}. (The first account on a fresh database is always an admin.)`);
await close();
