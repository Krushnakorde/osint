// Pull the public OpenPhish feed into the database now (the server also does this every FEED_REFRESH_HOURS).
import { boot } from './_context.ts';
const { services, close } = await boot();
console.log('Feed refresh:', await services.feeds.refresh());
await close();
