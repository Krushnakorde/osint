import type { AuthService } from '../../application/AuthService.ts';
import { AppError } from '../../domain/errors.ts';
import type { Middleware } from './Router.ts';

/** Requires `Authorization: Bearer <jwt>`; puts the verified user on the context. */
export const requireAuth = (auth: AuthService): Middleware => (next) => async (ctx) => {
  const header = ctx.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const userAgent = typeof ctx.headers['user-agent'] === 'string' ? ctx.headers['user-agent'] : '';
  const a = token ? await auth.authenticate(token, { ip: ctx.ip, userAgent }) : null;
  if (!a) throw new AppError(401, 'unauthenticated', 'Please log in.');
  return next({ ...ctx, auth: a });
};

export const requireAdmin: Middleware = (next) => async (ctx) => {
  if (ctx.auth?.user.role !== 'admin') throw new AppError(403, 'forbidden', 'Administrators only.');
  return next(ctx);
};
