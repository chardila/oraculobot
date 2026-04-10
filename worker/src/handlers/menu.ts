import type { TelegramCallbackQuery, Env, DbUser } from '../types';
import type { SupabaseClient } from '../supabase';
import { sendMenu, editMenu } from '../telegram';
import { showPredictionMatches, handlePredictionCallback, handlePredictionScoreCallback } from './prediction';
import { showRanking } from './ranking';
import { showMatches } from './matches';
import { startQuestion } from './question';
import { startAdminResult, handleAdminResultSelect } from './admin/result';
import { generateInviteCode } from './admin/invite';
import { startAdminMatch, handleAdminMatchPhaseCallback } from './admin/match';

function isAdmin(user: DbUser, env: Env): boolean {
  return String(user.telegram_id) === env.ADMIN_TELEGRAM_ID;
}

function buildButtons(admin: boolean): Array<Array<{ text: string; callback_data?: string; url?: string }>> {
  const base = [
    [
      { text: '🔮 Predecir', callback_data: 'menu:predict' },
      { text: '📊 Ranking', callback_data: 'menu:ranking' },
    ],
    [
      { text: '📅 Partidos', callback_data: 'menu:matches' },
      { text: '❓ Pregunta', callback_data: 'menu:question' },
    ],
    [
      { text: '🌐 Sitio', url: 'https://chardila.github.io/oraculobot/' },
    ],
  ];

  if (admin) {
    base.push([
      { text: '✅ Resultado', callback_data: 'menu:admin_result' },
      { text: '🎟 Invitar', callback_data: 'menu:admin_invite' },
    ]);
    base.push([
      { text: '➕ Partido', callback_data: 'menu:admin_match' },
    ]);
  }

  return base;
}

export async function showMainMenu(
  chatId: number,
  isAdminUser: boolean,
  env: Env
): Promise<void> {
  await sendMenu(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    '🌍 <b>OraculoBot — Mundial 2026</b>\n\n¿Qué quieres hacer?',
    buildButtons(isAdminUser)
  );
}

export async function handleMenuCallback(
  cq: TelegramCallbackQuery,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const data = cq.data ?? '';
  const chatId = cq.message!.chat.id;
  const msgId = cq.message!.message_id;
  const admin = isAdmin(user, env);

  // Admin match phase button selection
  if (data.startsWith('match:phase:')) {
    if (!admin) return;
    await handleAdminMatchPhaseCallback(data, chatId, user, db, env);
    return;
  }

  // Admin result match selection
  if (data.startsWith('admin:result:')) {
    if (!admin) return;
    const matchId = data.replace('admin:result:', '');
    await handleAdminResultSelect(matchId, chatId, user, db, env);
    return;
  }

  // Prediction match selection or score button
  if (data.startsWith('predict:')) {
    if (data.startsWith('predict:score:')) {
      await handlePredictionScoreCallback(cq, user, db, env);
    } else {
      await handlePredictionCallback(cq, user, db, env);
    }
    return;
  }

  if (!data.startsWith('menu:')) return;
  const action = data.replace('menu:', '');

  switch (action) {
    case 'predict':
      await showPredictionMatches(chatId, msgId, db, env);
      break;
    case 'ranking':
      await showRanking(chatId, msgId, db, env);
      break;
    case 'matches':
      await showMatches(chatId, msgId, db, env);
      break;
    case 'question':
      await startQuestion(chatId, user, db, env);
      break;
    case 'admin_result':
      if (admin) await startAdminResult(chatId, msgId, db, env);
      break;
    case 'admin_invite':
      if (admin) await generateInviteCode(chatId, msgId, user, db, env);
      break;
    case 'admin_match':
      if (admin) await startAdminMatch(chatId, user, db, env);
      break;
    case 'main':
      await editMenu(
        env.TELEGRAM_BOT_TOKEN, chatId, msgId,
        '🌍 <b>OraculoBot — Mundial 2026</b>\n\n¿Qué quieres hacer?',
        buildButtons(admin)
      );
      break;
  }
}
