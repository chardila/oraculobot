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

  let actionLink: string;
  try {
    const result = await db.generateMagicLink(body.email, `${env.WEB_ORIGIN}/jugar.html`);
    actionLink = result.action_link;
  } catch (e) {
    console.error('Magic link error:', e);
    return Response.json({ error: 'No se pudo enviar el enlace mágico' }, { status: 500 });
  }

  // DEBUG: return action_link directly so login works without email delivery
  return Response.json({ ok: true, message: 'Si tienes una cuenta, recibirás un enlace de acceso en tu correo', debug_link: actionLink });
}
