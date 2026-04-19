import type { DbUser, Env } from '../types';
import type { SupabaseClient } from '../supabase';

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function authenticate(request: Request, env: Env, db: SupabaseClient): Promise<DbUser> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('No autorizado', 401);
  }

  const token = authHeader.slice(7);

  // Delegate JWT verification to Supabase — works with ECC P-256, HS256, or any algorithm
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': env.SUPABASE_SERVICE_KEY,
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new AuthError('Token inválido o expirado', 401);
  }

  if (!res.ok) {
    throw new AuthError('Error al verificar sesión', 500);
  }

  const authUser = await res.json() as { id: string };

  const user = await db.getUserByAuthId(authUser.id);
  if (!user) {
    throw new AuthError('Necesitas un código de invitación para acceder', 403);
  }

  return user;
}
