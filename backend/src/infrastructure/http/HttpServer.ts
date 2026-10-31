import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AppError } from '../../domain/errors.ts';
import type { Router } from './Router.ts';

export interface HttpOptions { corsOrigin: string; staticDir?: string }
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c; if (data.length > 2_000_000) { reject(new AppError(413, 'too_large', 'Request body too large.')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new AppError(400, 'bad_json', 'Body must be valid JSON.')); } });
  });
}

/** Node `http` adapter: parsing, CORS, security headers, error mapping, static files. Business rules live elsewhere. */
export function createHttpServer(router: Router, opts: HttpOptions): http.Server {
  const send = (res: http.ServerResponse, status: number, body?: unknown): void => {
    res.writeHead(status, {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': opts.corsOrigin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', Vary: 'Origin',
    });
    res.end(status === 204 || body === undefined ? undefined : JSON.stringify(body));
  };
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      if (url.pathname.startsWith('/api/')) {
        const m = router.match(req.method ?? 'GET', url.pathname);
        if (m === null) return send(res, 404, { error: 'not_found', message: 'Unknown endpoint.' });
        if (m === 'method') return send(res, 405, { error: 'method_not_allowed', message: 'Method not allowed.' });
        const body = req.method === 'POST' ? await readBody(req) : {};
        const out = await m.handler({ method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, params: m.params, body, headers: req.headers, ip: req.socket.remoteAddress ?? 'unknown' });
        return send(res, out.status, out.body);
      }
      const dir = opts.staticDir;
      if (dir && fs.existsSync(dir)) {
        let file = path.join(dir, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
        if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
        fs.createReadStream(file).pipe(res);
        return;
      }
      send(res, 404, { error: 'not_found', message: 'Not found.' });
    } catch (e) {
      if (e instanceof AppError) return send(res, e.status, { error: e.code, message: e.message });
      console.error(e);
      send(res, 500, { error: 'internal', message: 'Something went wrong.' }); // never leak internals
    }
  });
}
