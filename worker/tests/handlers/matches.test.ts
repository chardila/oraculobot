import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as telegramModule from '../../src/telegram';

vi.mock('../../src/telegram');

describe('showMatches phase labels', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes phase label for upcoming group stage match', async () => {
    vi.mocked(telegramModule.editMenu).mockResolvedValue(undefined as any);

    const { showMatches } = await import('../../src/handlers/matches');

    const mockDb = {
      getUpcomingMatches: vi.fn(async () => [{
        id: '1', home_team: 'Colombia', away_team: 'Brasil',
        kickoff_at: '2026-06-15T23:00:00.000Z',
        phase: 'grupos', group_name: 'A',
        status: 'scheduled', home_score: null, away_score: null,
      }]),
      getRecentFinished: vi.fn(async () => []),
    };

    await showMatches(1, 100, mockDb as any, { TELEGRAM_BOT_TOKEN: 'token' } as any);

    const text = vi.mocked(telegramModule.editMenu).mock.calls[0][3] as string;
    expect(text).toContain('Grupos • Grupo A');
  });

  it('includes phase label for knockout match without group', async () => {
    vi.mocked(telegramModule.editMenu).mockResolvedValue(undefined as any);

    const { showMatches } = await import('../../src/handlers/matches');

    const mockDb = {
      getUpcomingMatches: vi.fn(async () => [{
        id: '2', home_team: 'Argentina', away_team: 'Francia',
        kickoff_at: '2026-07-14T23:00:00.000Z',
        phase: 'final', group_name: null,
        status: 'scheduled', home_score: null, away_score: null,
      }]),
      getRecentFinished: vi.fn(async () => []),
    };

    await showMatches(1, 100, mockDb as any, { TELEGRAM_BOT_TOKEN: 'token' } as any);

    const text = vi.mocked(telegramModule.editMenu).mock.calls[0][3] as string;
    expect(text).toContain('Final');
    expect(text).not.toContain('Grupo');
  });
});
