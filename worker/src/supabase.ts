import type {
  DbUser, DbMatch, DbPrediction, DbInviteCode, DbLeague, ConversationState
} from './types';

export class SupabaseClient {
  private url: string;
  private key: string;

  constructor(url: string, key: string) {
    this.url = url;
    this.key = key;
  }

  private async req<T>(
    path: string,
    options: RequestInit = {},
    query: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(`${this.url}/rest/v1/${path}`);
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

    const customPrefer = (options.headers as Record<string, string>)?.['Prefer'];
    const defaultPrefer = options.method === 'POST' ? 'return=representation' : 'return=minimal';
    const prefer = customPrefer ?? defaultPrefer;

    const res = await fetch(url.toString(), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Prefer': prefer,
        ...(options.headers as Record<string, string> ?? {}),
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Supabase ${path} ${res.status}: ${text}`);
      throw new Error(`Supabase ${path}: ${res.status} ${text}`);
    }

    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  // Users
  async getUserByTelegramId(telegramId: number): Promise<DbUser | null> {
    const rows = await this.req<DbUser[]>('users', {}, {
      telegram_id: `eq.${telegramId}`,
      limit: '1',
    });
    return rows?.[0] ?? null;
  }

  async createUser(data: Omit<DbUser, 'id' | 'created_at'>): Promise<DbUser> {
    const rows = await this.req<DbUser[]>('users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return rows[0];
  }

  // Leagues
  async getLeagues(): Promise<DbLeague[]> {
    return this.req<DbLeague[]>('leagues', {}, {
      select: 'id,name',
      order: 'created_at.asc',
    });
  }

  async createLeague(name: string): Promise<DbLeague> {
    const rows = await this.req<DbLeague[]>('leagues', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return rows[0];
  }

  // Invite codes
  async getInviteCode(code: string): Promise<DbInviteCode | null> {
    const rows = await this.req<DbInviteCode[]>('invite_codes', {}, {
      code: `eq.${code}`,
      limit: '1',
    });
    return rows?.[0] ?? null;
  }

  async tryConsumeInviteCode(code: string): Promise<boolean> {
    const result = await this.req<boolean>('rpc/try_consume_invite_code', {
      method: 'POST',
      body: JSON.stringify({ p_code: code }),
    });
    return result === true;
  }

  async createInviteCode(data: Omit<DbInviteCode, 'use_count' | 'created_at'>): Promise<DbInviteCode> {
    const rows = await this.req<DbInviteCode[]>('invite_codes', {
      method: 'POST',
      body: JSON.stringify({ ...data, use_count: 0 }),
    });
    return rows[0];
  }

  // Matches
  async getUpcomingMatches(cutoffMinutes = 5): Promise<DbMatch[]> {
    const cutoff = new Date(Date.now() + cutoffMinutes * 60 * 1000).toISOString();
    return this.req<DbMatch[]>('matches', {}, {
      status: 'eq.scheduled',
      kickoff_at: `gt.${cutoff}`,
      order: 'kickoff_at.asc',
      limit: '20',
    });
  }

  async getFinishedWithPastKickoff(): Promise<DbMatch[]> {
    const now = new Date().toISOString();
    return this.req<DbMatch[]>('matches', {}, {
      status: 'eq.scheduled',
      kickoff_at: `lt.${now}`,
      order: 'kickoff_at.asc',
    });
  }

  async getMatchById(id: string): Promise<DbMatch | null> {
    const rows = await this.req<DbMatch[]>('matches', {}, {
      id: `eq.${id}`,
      limit: '1',
    });
    return rows?.[0] ?? null;
  }

  async createMatch(data: Omit<DbMatch, 'id' | 'status' | 'home_score' | 'away_score'>): Promise<DbMatch> {
    const rows = await this.req<DbMatch[]>('matches', {
      method: 'POST',
      body: JSON.stringify({ ...data, status: 'scheduled' }),
    });
    return rows[0];
  }

  async finishMatch(id: string, homeScore: number, awayScore: number): Promise<void> {
    await this.req('matches', {
      method: 'PATCH',
      body: JSON.stringify({ home_score: homeScore, away_score: awayScore, status: 'finished' }),
      headers: { 'Prefer': 'return=minimal' },
    }, { id: `eq.${id}` });
  }

  async getRecentFinished(limit = 5): Promise<DbMatch[]> {
    return this.req<DbMatch[]>('matches', {}, {
      status: 'eq.finished',
      order: 'kickoff_at.desc',
      limit: String(limit),
    });
  }

  async getAllMatches(): Promise<DbMatch[]> {
    return this.req<DbMatch[]>('matches', {}, {
      order: 'kickoff_at.asc',
      limit: '200',
    });
  }

  // Predictions
  async getPredictionsByMatch(matchId: string): Promise<DbPrediction[]> {
    return this.req<DbPrediction[]>('predictions', {}, {
      match_id: `eq.${matchId}`,
    });
  }

  async getPredictionByUserAndMatch(userId: string, matchId: string): Promise<DbPrediction | null> {
    const rows = await this.req<DbPrediction[]>('predictions', {}, {
      user_id: `eq.${userId}`,
      match_id: `eq.${matchId}`,
      limit: '1',
    });
    return rows?.[0] ?? null;
  }

  async upsertPrediction(data: Pick<DbPrediction, 'user_id' | 'match_id' | 'home_score' | 'away_score'>): Promise<void> {
    await this.req('predictions', {
      method: 'POST',
      body: JSON.stringify({ ...data, predicted_at: new Date().toISOString() }),
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    });
  }

  async updatePredictionPoints(id: string, points: number): Promise<void> {
    await this.req('predictions', {
      method: 'PATCH',
      body: JSON.stringify({ points }),
      headers: { 'Prefer': 'return=minimal' },
    }, { id: `eq.${id}` });
  }

  async getLeaderboard(leagueId: string): Promise<Array<{ user_id: string; total_points: number; username: string | null }>> {
    return this.req<Array<{ user_id: string; total_points: number; username: string | null }>>(
      'rpc/leaderboard', { method: 'POST', body: JSON.stringify({ p_league_id: leagueId }) }
    );
  }

  // Conversation state
  async getConversationState(telegramId: number): Promise<ConversationState | null> {
    const rows = await this.req<ConversationState[]>('conversation_state', {}, {
      telegram_id: `eq.${telegramId}`,
      limit: '1',
    });
    return rows?.[0] ?? null;
  }

  async setConversationState(telegramId: number, step: string, context: Record<string, unknown>): Promise<void> {
    await this.req('conversation_state', {
      method: 'POST',
      body: JSON.stringify({ telegram_id: telegramId, step, context, updated_at: new Date().toISOString() }),
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    });
  }

  async clearConversationState(telegramId: number): Promise<void> {
    await this.req('conversation_state', {
      method: 'DELETE',
      headers: { 'Prefer': 'return=minimal' },
    }, { telegram_id: `eq.${telegramId}` });
  }

  // Web auth
  async getUserByAuthId(authUserId: string): Promise<DbUser | null> {
    const rows = await this.req<DbUser[]>('users', {}, {
      auth_user_id: `eq.${authUserId}`,
      limit: '1',
    });
    return rows?.[0] ?? null;
  }

  async createWebUser(authUserId: string, inviteCode: string, leagueId: string, username: string): Promise<DbUser> {
    const rows = await this.req<DbUser[]>('users', {
      method: 'POST',
      body: JSON.stringify({ auth_user_id: authUserId, invite_code: inviteCode, league_id: leagueId, username }),
    });
    return rows[0];
  }

  async getAuthUserByEmail(email: string): Promise<{ id: string } | null> {
    const url = new URL(`${this.url}/auth/v1/admin/users`);
    url.searchParams.set('filter', email);
    const res = await fetch(url.toString(), {
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
      },
    });
    if (!res.ok) return null;
    const body = await res.json() as { users?: Array<{ id: string; email?: string }> };
    return body.users?.find(u => u.email === email) ?? null;
  }

  async createAuthUser(email: string): Promise<{ id: string }> {
    const res = await fetch(`${this.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
      },
      body: JSON.stringify({ email, email_confirm: true }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase create user: ${res.status} ${text}`);
    }
    return res.json() as Promise<{ id: string }>;
  }

  async sendMagicLinkOtp(email: string, redirectTo: string): Promise<void> {
    const url = `${this.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
      },
      body: JSON.stringify({ email }),
    });

    if (res.status === 429) {
      throw Object.assign(new Error('rate_limited'), { code: 'rate_limited' });
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase otp: ${res.status} ${text}`);
    }
  }

  async setQuestionsToday(userId: string, count: number, resetAt?: string): Promise<void> {
    const patch: Record<string, unknown> = { questions_today: count };
    if (resetAt !== undefined) patch.questions_reset_at = resetAt;
    await this.req('users', {
      method: 'PATCH',
      body: JSON.stringify(patch),
      headers: { 'Prefer': 'return=minimal' },
    }, { id: `eq.${userId}` });
  }
}
