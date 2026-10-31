import type { IncomingHttpHeaders } from 'node:http';
import type { Authenticated } from '../../application/AuthService.ts';

export interface Ctx {
  method: string; path: string; query: URLSearchParams; params: Record<string, string>;
  body: unknown; headers: IncomingHttpHeaders; ip: string; auth?: Authenticated;
}
export interface HttpResult { status: number; body?: unknown }
export type Handler = (ctx: Ctx) => Promise<HttpResult>;
export type Middleware = (next: Handler) => Handler;

interface Route { method: string; parts: string[]; handler: Handler }

/** Tiny router: exact segments and `:param` segments. Middleware wraps a handler (auth, role checks). */
export class Router {
  private readonly routes: Route[] = [];
  add(method: string, path: string, handler: Handler, ...middleware: Middleware[]): this {
    const wrapped = middleware.reduceRight<Handler>((h, mw) => mw(h), handler);
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler: wrapped });
    return this;
  }
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | 'method' | null {
    const parts = path.split('/').filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      const ok = r.parts.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(parts[i] as string)), true) : p === parts[i]));
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { handler: r.handler, params };
    }
    return pathMatched ? 'method' : null;
  }
}
