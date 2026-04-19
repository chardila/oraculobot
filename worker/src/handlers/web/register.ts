import type { Env, WebRegisterRequest } from '../../types';
import { SupabaseClient } from '../../supabase';

export async function handleWebRegister(request: Request, env: Env): Promise<Response> {
  let body: WebRegisterRequest;
  try {
    body = await request.json() as WebRegisterRequest;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { email, invite_code } = body;
  if (!email || !invite_code) {
    return Response.json({ error: 'Email e invite_code son requeridos' }, { status: 400 });
  }

  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  const code = await db.getInviteCode(invite_code);
  if (!code || code.use_count >= code.max_uses) {
    return Response.json({ error: 'Código de invitación inválido o expirado' }, { status: 400 });
  }

  let authUserId: string;
  try {
    const result = await db.generateMagicLink(email, `${env.WEB_ORIGIN}/jugar.html`);
    authUserId = result.user.id;
  } catch (e) {
    console.error('Magic link error:', e);
    return Response.json({ error: 'No se pudo enviar el enlace mágico' }, { status: 500 });
  }

  // Only create user row and consume invite code on first registration
  const existing = await db.getUserByAuthId(authUserId);
  if (!existing) {
    await db.createWebUser(authUserId, invite_code);
    await db.incrementInviteCodeUse(invite_code);
  }

  return Response.json({ ok: true, message: 'Revisa tu correo para el enlace de acceso' });
}
