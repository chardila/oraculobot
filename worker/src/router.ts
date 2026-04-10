import type { TelegramUpdate, Env } from './types';
import { SupabaseClient } from './supabase';
import { sendMessage, answerCallback } from './telegram';
import { handleRegistration } from './handlers/registration';
import { showMainMenu, handleMenuCallback } from './handlers/menu';
import { handlePredictionText } from './handlers/prediction';
import { handleQuestionText } from './handlers/question';
import { handleAdminResultText } from './handlers/admin/result';
import { handleAdminMatchText } from './handlers/admin/match';

const CONVERSATION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export function isStateStale(updatedAt: string, ttlMs = CONVERSATION_TTL_MS): boolean {
  return Date.now() - new Date(updatedAt).getTime() > ttlMs;
}

export async function route(update: TelegramUpdate, env: Env): Promise<void> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  // Handle inline button press
  if (update.callback_query) {
    const cq = update.callback_query;
    await answerCallback(env.TELEGRAM_BOT_TOKEN, cq.id);

    const user = await db.getUserByTelegramId(cq.from.id);
    if (!user) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, cq.message!.chat.id,
        'Necesitas un código de invitación para usar este bot. Envía tu código.');
      return;
    }

    await handleMenuCallback(cq, user, db, env);
    return;
  }

  // Handle text message
  if (!update.message?.text) return;

  const msg = update.message;
  const telegramId = msg.from.id;
  const chatId = msg.chat.id;

  const isAdminUser = String(telegramId) === env.ADMIN_TELEGRAM_ID;
  const user = await db.getUserByTelegramId(telegramId);

  if (!user) {
    await handleRegistration(msg, db, env, (cId, adminFlag, e) =>
      showMainMenu(cId, adminFlag, e)
    );
    return;
  }

  // Cancel command: clear any active state and show menu
  if (msg.text === '/cancel') {
    await db.clearConversationState(telegramId);
    await showMainMenu(chatId, isAdminUser, env);
    return;
  }

  // Check for active conversation state
  const state = await db.getConversationState(telegramId);

  // TTL check: clear stale state instead of resuming it
  if (state && isStateStale(state.updated_at)) {
    await db.clearConversationState(telegramId);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⏱ Tu sesión anterior expiró.');
    await showMainMenu(chatId, isAdminUser, env);
    return;
  }

  if (state) {
    switch (state.step) {
      case 'awaiting_prediction_score':
        await handlePredictionText(msg, state, user, db, env);
        return;
      case 'awaiting_question':
        await handleQuestionText(msg, state, user, db, env);
        return;
      case 'awaiting_result_score':
        await handleAdminResultText(msg, state, user, db, env);
        return;
      case 'awaiting_match_home_team':
      case 'awaiting_match_away_team':
      case 'awaiting_match_kickoff':
      case 'awaiting_match_phase':
      case 'awaiting_match_group':
        await handleAdminMatchText(msg, state, user, db, env);
        return;
    }
  }

  // Default: show main menu
  await showMainMenu(chatId, isAdminUser, env);
}
