import { AppError } from '../domain/errors.ts';
import type { NewSearchEvent, SearchEvent, SearchEventRepository } from './ports.ts';

/** Single responsibility: a user's search history. */
export class SearchHistoryService {
  private readonly events: SearchEventRepository;
  constructor(events: SearchEventRepository) { this.events = events; }
  record(e: NewSearchEvent): Promise<SearchEvent> { return this.events.add(e); }
  list(userId: string, limit = 50, before?: string): Promise<SearchEvent[]> {
    return this.events.listByUser(userId, { limit: Math.min(Math.max(1, limit), 200), before });
  }
  async remove(userId: string, id: string): Promise<void> {
    if (!(await this.events.deleteOne(userId, id))) throw new AppError(404, 'not_found', 'History entry not found.');
  }
  clear(userId: string): Promise<number> { return this.events.clearUser(userId); }
}
