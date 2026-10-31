import type { FeedSource } from '../../application/FeedService.ts';
import { openphishHosts, warmLists } from './lists.ts';

/** The public OpenPhish community feed. */
export const openPhishSource: FeedSource = {
  name: 'openphish',
  async load() { await warmLists(); return openphishHosts(); },
};
