import type { Env, WebRegisterRequest } from '../../types';
import { SupabaseClient } from '../../supabase';

export async function handleWebRegister(request: Request, env: Env): Promise<Response> {
  let body: WebRegisterRequest;
  try {
    body = await request.json() as WebRegisterRequest;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { email, invite_code, name } = body;
  if (!email || !invite_code || !name?.trim()) {
    return Response.json({ error: 'Email, nombre e invite_code son requeridos' }, { status: 400 });
  }

  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  let authUserId: string;
  try {
    const authUser = await db.getAuthUserByEmail(email) ?? await db.createAuthUser(email);
    authUserId = authUser.id;
  } catch (e) {
    console.error('Auth user lookup/create error:', e);
    return Response.json({ error: 'No se pudo procesar el registro' }, { status: 500 });
  }

  // Only create user row and consume invite code on first registration
  const existing = await db.getUserByAuthId(authUserId);
  if (!existing) {
    const inviteCode = await db.getInviteCode(invite_code);
    if (!inviteCode) {
      return Response.json({ error: 'Código de invitación inválido o expirado' }, { status: 400 });
    }
    const consumed = await db.tryConsumeInviteCode(invite_code);
    if (!consumed) {
      return Response.json({ error: 'Código de invitación inválido o expirado' }, { status: 400 });
    }
    await db.createWebUser(authUserId, invite_code, inviteCode.league_id, name.trim());
  }

  try {
    await db.sendMagicLinkOtp(email, env.WEB_REDIRECT_URL);
  } catch (e) {
    console.error('OTP send error:', e);
    return Response.json({ error: 'No se pudo enviar el enlace mágico' }, { status: 500 });
  }

  return Response.json({ ok: true, message: 'Revisa tu correo para el enlace de acceso' });
}
