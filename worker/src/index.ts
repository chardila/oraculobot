import type { Env } from './types';
import { route } from './router';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const update = await request.json();
      // waitUntil keeps the worker alive until route() completes
      ctx.waitUntil(route(update, env).catch(console.error));
    } catch (e) {
      console.error('Failed to parse update', e);
    }

    return new Response('OK', { status: 200 });
  },
};
