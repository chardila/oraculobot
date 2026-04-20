import type { Env } from '../../types';
import { SupabaseClient } from '../../supabase';

export async function handleWebLogin(request: Request, env: Env): Promise<Response> {
  let body: { email: string };
  try {
    body = await request.json() as { email: string };
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.email) {
    return Response.json({ error: 'Email es requerido' }, { status: 400 });
  }

  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  try {
    await db.generateMagicLink(body.email, env.WEB_REDIRECT_URL);
  } catch (e) {
    console.error('Magic link error:', e);
    return Response.json({ error: 'No se pudo enviar el enlace mágico' }, { status: 500 });
  }

  return Response.json({ ok: true, message: 'Si tienes una cuenta, recibirás un enlace de acceso en tu correo' });
}
