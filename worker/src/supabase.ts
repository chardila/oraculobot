import type {
  DbUser, DbMatch, DbPrediction, DbInviteCode, ConversationState
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

  // Invite codes
  async getInviteCode(code: string): Promise<DbInviteCode | null> {
    const rows = await this.req<DbInviteCode[]>('invite_codes', {}, {
      code: `eq.${code}`,
      limit: '1',
    });
    return rows?.[0] ?? null;
  }

  async incrementInviteCodeUse(code: string): Promise<void> {
    // Atomic increment via RPC to avoid race conditions
    await this.req('rpc/increment_invite_use', {
      method: 'POST',
      body: JSON.stringify({ p_code: code }),
      headers: { 'Prefer': 'return=minimal' },
    });
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

  async getLeaderboard(): Promise<Array<{ user_id: string; total_points: number; username: string | null }>> {
    return this.req<Array<{ user_id: string; total_points: number; username: string | null }>>(
      'rpc/leaderboard', { method: 'POST', body: '{}' }
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
}
