import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as telegramModule from '../../../src/telegram';

vi.mock('../../../src/telegram');

describe('admin match: phase buttons', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends inline keyboard with phase options after kickoff is entered', async () => {
    vi.mocked(telegramModule.sendMessage).mockResolvedValue(undefined as any);
    vi.mocked(telegramModule.sendMenu).mockResolvedValue(undefined as any);

    const { handleAdminMatchText } = await import('../../../src/handlers/admin/match');

    const mockDb = {
      setConversationState: vi.fn(async () => {}),
      clearConversationState: vi.fn(async () => {}),
      createMatch: vi.fn(async () => ({})),
    };

    const state = {
      step: 'awaiting_match_kickoff',
      context: { home_team: 'Colombia', away_team: 'Brasil' },
      updated_at: new Date().toISOString(),
    };

    const msg = {
      chat: { id: 1 },
      from: { id: 999, first_name: 'Admin' },
      text: '2026-06-15T18:00:00-05:00',
    } as any;

    await handleAdminMatchText(msg, state as any, { telegram_id: 999 } as any, mockDb as any, { TELEGRAM_BOT_TOKEN: 'token' } as any);

    const calls = vi.mocked(telegramModule.sendMenu).mock.calls;
    expect(calls.length).toBe(1);
    const buttons = calls[0][3] as any[][];
    const allCallbacks = buttons.flat().map((b: any) => b.callback_data);
    expect(allCallbacks).toContain('match:phase:grupos');
    expect(allCallbacks).toContain('match:phase:final');
  });
});

describe('admin match: handleAdminMatchPhaseCallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for group when phase is grupos', async () => {
    vi.mocked(telegramModule.sendMessage).mockResolvedValue(undefined as any);

    const { handleAdminMatchPhaseCallback } = await import('../../../src/handlers/admin/match');

    const mockDb = {
      getConversationState: vi.fn(async () => ({
        step: 'awaiting_match_phase',
        context: { home_team: 'Colombia', away_team: 'Brasil', kickoff_at: '2026-06-15T23:00:00.000Z' },
      })),
      setConversationState: vi.fn(async () => {}),
      clearConversationState: vi.fn(async () => {}),
      createMatch: vi.fn(async () => ({})),
    };

    await handleAdminMatchPhaseCallback(
      'match:phase:grupos', 1,
      { id: 'u1', telegram_id: 999 } as any,
      mockDb as any,
      { TELEGRAM_BOT_TOKEN: 'token' } as any
    );

    expect(mockDb.setConversationState).toHaveBeenCalledWith(999, 'awaiting_match_group', expect.objectContaining({ phase: 'grupos' }));
    const text = vi.mocked(telegramModule.sendMessage).mock.calls[0][2];
    expect(text).toContain('Grupo');
  });

  it('creates match directly when phase is not grupos', async () => {
    vi.mocked(telegramModule.sendMessage).mockResolvedValue(undefined as any);

    const { handleAdminMatchPhaseCallback } = await import('../../../src/handlers/admin/match');

    const mockDb = {
      getConversationState: vi.fn(async () => ({
        step: 'awaiting_match_phase',
        context: { home_team: 'Argentina', away_team: 'Francia', kickoff_at: '2026-07-14T23:00:00.000Z' },
      })),
      setConversationState: vi.fn(async () => {}),
      clearConversationState: vi.fn(async () => {}),
      createMatch: vi.fn(async () => ({ id: 'new-match' })),
    };

    await handleAdminMatchPhaseCallback(
      'match:phase:final', 1,
      { id: 'u1', telegram_id: 999 } as any,
      mockDb as any,
      { TELEGRAM_BOT_TOKEN: 'token' } as any
    );

    expect(mockDb.createMatch).toHaveBeenCalledWith(expect.objectContaining({ phase: 'final', group_name: null }));
    expect(mockDb.clearConversationState).toHaveBeenCalled();
  });
});
