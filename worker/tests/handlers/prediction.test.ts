import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as telegramModule from '../../src/telegram';

vi.mock('../../src/telegram');

// ─── Task 4: Cutoff warning ───────────────────────────────────────────────────

describe('handlePredictionCallback: cutoff warning', () => {
  beforeEach(() => vi.clearAllMocks());

  async function callHandler(minutesUntilKickoff: number) {
    vi.mocked(telegramModule.sendMessage).mockResolvedValue(undefined as any);
    vi.mocked(telegramModule.sendMenu).mockResolvedValue(undefined as any);

    const kickoff = new Date(Date.now() + minutesUntilKickoff * 60 * 1000).toISOString();
    const { handlePredictionCallback } = await import('../../src/handlers/prediction');

    const mockDb = {
      getMatchById: vi.fn(async () => ({
        id: 'm1', home_team: 'Colombia', away_team: 'Brasil',
        kickoff_at: kickoff, phase: 'grupos', group_name: 'A',
        status: 'scheduled', home_score: null, away_score: null,
      })),
      getPredictionByUserAndMatch: vi.fn(async () => null),
      setConversationState: vi.fn(async () => {}),
    };

    const cq = {
      id: 'cq1', from: { id: 1, first_name: 'Test' },
      message: { message_id: 10, chat: { id: 1 }, from: { id: 1, first_name: 'Bot' } },
      data: 'predict:match:m1',
    } as any;

    await handlePredictionCallback(cq, { id: 'u1', telegram_id: 1 } as any, mockDb as any, { TELEGRAM_BOT_TOKEN: 'token' } as any);
    return vi.mocked(telegramModule.sendMenu).mock.calls;
  }

  it('shows warning when less than 30 minutes to kickoff', async () => {
    const calls = await callHandler(15);
    const text = calls[0][2] as string;
    expect(text).toContain('⚠️');
    expect(text).toContain('Cierra en');
  });

  it('does not show warning when more than 30 minutes to kickoff', async () => {
    const calls = await callHandler(60);
    const text = calls[0][2] as string;
    expect(text).not.toContain('⚠️');
  });
});

// ─── Task 5: Show existing prediction ────────────────────────────────────────

describe('handlePredictionCallback: show existing prediction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows current prediction in prompt when user already predicted', async () => {
    vi.mocked(telegramModule.sendMessage).mockResolvedValue(undefined as any);
    vi.mocked(telegramModule.sendMenu).mockResolvedValue(undefined as any);

    const { handlePredictionCallback } = await import('../../src/handlers/prediction');

    const kickoff = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const mockDb = {
      getMatchById: vi.fn(async () => ({
        id: 'm1', home_team: 'Colombia', away_team: 'Brasil',
        kickoff_at: kickoff, phase: 'grupos', group_name: 'A',
        status: 'scheduled', home_score: null, away_score: null,
      })),
      getPredictionByUserAndMatch: vi.fn(async () => ({ home_score: 2, away_score: 1 })),
      setConversationState: vi.fn(async () => {}),
    };

    const cq = {
      id: 'cq1', from: { id: 1, first_name: 'Test' },
      message: { message_id: 10, chat: { id: 1 }, from: { id: 1, first_name: 'Bot' } },
      data: 'predict:match:m1',
    } as any;

    await handlePredictionCallback(cq, { id: 'u1', telegram_id: 1 } as any, mockDb as any, { TELEGRAM_BOT_TOKEN: 'token' } as any);

    const text = vi.mocked(telegramModule.sendMenu).mock.calls[0][2] as string;
    expect(text).toContain('predicción actual');
    expect(text).toContain('2 - 1');
  });

  it('does not show prediction header when user has no prediction yet', async () => {
    vi.mocked(telegramModule.sendMenu).mockResolvedValue(undefined as any);

    const { handlePredictionCallback } = await import('../../src/handlers/prediction');

    const kickoff = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const mockDb = {
      getMatchById: vi.fn(async () => ({
        id: 'm2', home_team: 'Argentina', away_team: 'Mexico',
        kickoff_at: kickoff, phase: 'grupos', group_name: 'B',
        status: 'scheduled', home_score: null, away_score: null,
      })),
      getPredictionByUserAndMatch: vi.fn(async () => null),
      setConversationState: vi.fn(async () => {}),
    };

    const cq = {
      id: 'cq2', from: { id: 1, first_name: 'Test' },
      message: { message_id: 10, chat: { id: 1 }, from: { id: 1, first_name: 'Bot' } },
      data: 'predict:match:m2',
    } as any;

    await handlePredictionCallback(cq, { id: 'u1', telegram_id: 1 } as any, mockDb as any, { TELEGRAM_BOT_TOKEN: 'token' } as any);

    const text = vi.mocked(telegramModule.sendMenu).mock.calls[0][2] as string;
    expect(text).not.toContain('predicción actual');
  });
});

// ─── Task 6: Score buttons ────────────────────────────────────────────────────

describe('handlePredictionCallback: score buttons', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows score buttons in the prediction prompt', async () => {
    vi.mocked(telegramModule.sendMenu).mockResolvedValue(undefined as any);

    const { handlePredictionCallback } = await import('../../src/handlers/prediction');

    const kickoff = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const mockDb = {
      getMatchById: vi.fn(async () => ({
        id: 'm1', home_team: 'Colombia', away_team: 'Brasil',
        kickoff_at: kickoff, phase: 'grupos', group_name: 'A',
        status: 'scheduled', home_score: null, away_score: null,
      })),
      getPredictionByUserAndMatch: vi.fn(async () => null),
      setConversationState: vi.fn(async () => {}),
    };

    const cq = {
      id: 'cq1', from: { id: 1, first_name: 'Test' },
      message: { message_id: 10, chat: { id: 1 }, from: { id: 1, first_name: 'Bot' } },
      data: 'predict:match:m1',
    } as any;

    await handlePredictionCallback(cq, { id: 'u1', telegram_id: 1 } as any, mockDb as any, { TELEGRAM_BOT_TOKEN: 'token' } as any);

    const buttons = vi.mocked(telegramModule.sendMenu).mock.calls[0][3] as any[][];
    const allCallbacks = buttons.flat().map((b: any) => b.callback_data);
    expect(allCallbacks.some(cb => cb.startsWith('predict:score:m1:'))).toBe(true);
    expect(allCallbacks).toContain('predict:score:m1:0-0');
    expect(allCallbacks).toContain('predict:score:m1:2-1');
  });
});

describe('handlePredictionScoreCallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves prediction and confirms when score button is tapped', async () => {
    vi.mocked(telegramModule.sendMessage).mockResolvedValue(undefined as any);

    const { handlePredictionScoreCallback } = await import('../../src/handlers/prediction');

    const kickoff = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const mockDb = {
      getMatchById: vi.fn(async () => ({
        id: 'm1', home_team: 'Colombia', away_team: 'Brasil',
        kickoff_at: kickoff, phase: 'grupos', group_name: 'A',
        status: 'scheduled', home_score: null, away_score: null,
      })),
      upsertPrediction: vi.fn(async () => {}),
      clearConversationState: vi.fn(async () => {}),
    };

    const cq = {
      id: 'cq1', from: { id: 1, first_name: 'Test' },
      message: { message_id: 10, chat: { id: 1 }, from: { id: 1, first_name: 'Bot' } },
      data: 'predict:score:m1:2-1',
    } as any;

    await handlePredictionScoreCallback(cq, { id: 'u1', telegram_id: 1 } as any, mockDb as any, { TELEGRAM_BOT_TOKEN: 'token' } as any);

    expect(mockDb.upsertPrediction).toHaveBeenCalledWith({
      user_id: 'u1', match_id: 'm1', home_score: 2, away_score: 1,
    });

    const confirmText = vi.mocked(telegramModule.sendMessage).mock.calls[0][2];
    expect(confirmText).toContain('✅');
    expect(confirmText).toContain('2 - 1');
  });
});
