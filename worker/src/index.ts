import type { Env } from './types';
import { route } from './router';
import { corsPreflight, withCors } from './middleware/cors';
import { handleWebRegister } from './handlers/web/register';
import { handleWebLogin } from './handlers/web/login';
import { handleWebMatches } from './handlers/web/matches';
import { handleWebRanking } from './handlers/web/ranking';
import { handleWebPredict } from './handlers/web/predict';
import { handleWebQuestion } from './handlers/web/question';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method, pathname } = { method: request.method, pathname: url.pathname };
    const origin = env.WEB_ORIGIN;

    // CORS preflight for all routes
    if (method === 'OPTIONS') {
      return corsPreflight(origin);
    }

    // Web API routes
    if (pathname.startsWith('/api/')) {
      let response: Response;
      try {
        if (pathname === '/api/register' && method === 'POST') {
          response = await handleWebRegister(request, env);
        } else if (pathname === '/api/login' && method === 'POST') {
          response = await handleWebLogin(request, env);
        } else if (pathname === '/api/matches' && method === 'GET') {
          response = await handleWebMatches(request, env);
        } else if (pathname === '/api/ranking' && method === 'GET') {
          response = await handleWebRanking(request, env);
        } else if (pathname === '/api/predict' && method === 'POST') {
          response = await handleWebPredict(request, env);
        } else if (pathname === '/api/question' && method === 'POST') {
          response = await handleWebQuestion(request, env);
        } else {
          response = Response.json({ error: 'Not found' }, { status: 404 });
        }
      } catch (e) {
        console.error('Web API error:', e);
        response = Response.json({ error: 'Error interno del servidor' }, { status: 500 });
      }
      return withCors(response, origin);
    }

    // Telegram webhook: POST /
    if (method === 'POST' && pathname === '/') {
      try {
        const update = await request.json() as import('./types').TelegramUpdate;
        ctx.waitUntil(route(update, env).catch(console.error));
      } catch (e) {
        console.error('Failed to parse Telegram update', e);
      }
      return new Response('OK', { status: 200 });
    }

    return new Response('OK', { status: 200 });
  },
};
