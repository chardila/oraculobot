import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleQuestionText } from '../../src/handlers/question';
import * as deepseekModule from '../../src/services/deepseek';
import * as telegramModule from '../../src/telegram';

vi.mock('../../src/services/deepseek');
vi.mock('../../src/telegram');

describe('question handler system prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes Colombia timezone instruction', async () => {
    vi.mocked(deepseekModule.askDeepSeek).mockResolvedValue('respuesta mock');
    vi.mocked(telegramModule.sendMessage).mockResolvedValue(undefined as any);

    const mockDb = {
      getLeaderboard: vi.fn(async () => []),
      getAllMatches: vi.fn(async () => []),
      getRecentFinished: vi.fn(async () => []),
      setConversationState: vi.fn(async () => {}),
      clearConversationState: vi.fn(async () => {}),
    };

    const mockEnv = { TELEGRAM_BOT_TOKEN: 'token', DEEPSEEK_API_KEY: 'key' } as any;
    const mockMsg = { chat: { id: 1 }, text: '¿A qué hora juega Colombia?' } as any;
    const mockUser = { telegram_id: 1, username: 'test' } as any;
    const mockState = {} as any;

    await handleQuestionText(mockMsg, mockState, mockUser, mockDb as any, mockEnv);

    const calls = vi.mocked(deepseekModule.askDeepSeek).mock.calls;
    expect(calls.length).toBe(1);
    const systemPrompt = calls[0][1];
    expect(systemPrompt).toContain('Colombia (UTC-5)');
  });
});
