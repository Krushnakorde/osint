import { boot } from './_context.ts';
import { ScryptPasswordHasher } from '../src/infrastructure/security/crypto.ts';

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error('Usage: npm run reset-password -- <email> <newPassword>');
  process.exit(1);
}

const { services, close } = await boot();
const hasher = new ScryptPasswordHasher();
const hash = await hasher.hash(newPassword);

const mongoose = (await import('mongoose')).default;
if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
  const result = await mongoose.connection.db.collection('users').updateOne(
    { email: email.toLowerCase() },
    { $set: { passwordHash: hash, role: 'admin' } }
  );
  console.log(`Password updated for ${email} in MongoDB: matched ${result.matchedCount}, modified ${result.modifiedCount}`);
} else {
  console.error('MongoDB is not connected.');
}

await close();
