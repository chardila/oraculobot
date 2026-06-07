import type { TelegramCallbackQuery, Env, DbUser, InlineKeyboardButton } from '../types';
import type { SupabaseClient } from '../supabase';
import { sendMessage, sendMenu, editMenu } from '../telegram';
import { startAdminResult, handleAdminResultSelect, handleAdminPenaltyWinner } from './admin/result';
import { startAdminRecalculate, handleAdminRecalcSelect, handleAdminRecalcConfirm, handleAdminRecalcPenaltyWinner } from './admin/recalculate';
import { handleProposeDecision } from './admin/propose';
import { generateInviteCode, handleInviteLeagueCallback } from './admin/invite';
import { startAdminLeague } from './admin/league';

function isAdmin(user: DbUser, env: Env): boolean {
  return String(user.telegram_id!) === env.ADMIN_TELEGRAM_ID;
}

export function buildAdminButtons(): InlineKeyboardButton[][] {
  return [
    [
      { text: '✅ Resultado', callback_data: 'menu:admin_result' },
      { text: '🎟 Invitar',   callback_data: 'menu:admin_invite' },
    ],
    [
      { text: '🔄 Recalcular', callback_data: 'menu:admin_recalc' },
      { text: '🏆 Crear polla', callback_data: 'menu:admin_league' },
    ],
  ];
}

export async function showMainMenu(
  chatId: number,
  isAdminUser: boolean,
  env: Env,
  name?: string
): Promise<void> {
  if (!isAdminUser) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '👋 Para participar en OraculoBot entra al sitio web con tu código de invitación.');
    return;
  }
  const greeting = name ? `Hola, <b>${name}</b>! ` : '';
  await sendMenu(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `${greeting}🌍 <b>OraculoBot — Admin</b>\n\n¿Qué quieres hacer?`,
    buildAdminButtons()
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

  // Admin result match selection
  if (data.startsWith('admin:result:')) {
    if (!admin) return;
    const matchId = data.replace('admin:result:', '');
    await handleAdminResultSelect(matchId, chatId, user, db, env);
    return;
  }

  if (data === 'admin:penalty:home' || data === 'admin:penalty:away') {
    if (!admin) return;
    const winner = data === 'admin:penalty:home' ? 'home' : 'away';
    await handleAdminPenaltyWinner(winner, chatId, user, db, env);
    return;
  }

  // Auto-result proposal confirm/reject
  if (data.startsWith('admin:propose:')) {
    if (!admin) return;
    // format: admin:propose:confirm:<uuid> or admin:propose:reject:<uuid>
    const parts = data.split(':');
    const decision = parts[2] as 'confirm' | 'reject';
    const proposalId = parts[3];
    await handleProposeDecision(decision, proposalId, chatId, msgId, db, env);
    return;
  }

  // Admin recalculate flow
  if (data.startsWith('admin:recalc:')) {
    if (!admin) return;
    const sub = data.replace('admin:recalc:', '');
    if (sub === 'confirm') {
      await handleAdminRecalcConfirm(chatId, user, db, env);
      return;
    }
    if (sub === 'penalty:home') {
      await handleAdminRecalcPenaltyWinner('home', chatId, user, db, env);
      return;
    }
    if (sub === 'penalty:away') {
      await handleAdminRecalcPenaltyWinner('away', chatId, user, db, env);
      return;
    }
    // sub is a match ID
    await handleAdminRecalcSelect(sub, chatId, user, db, env);
    return;
  }

  // Admin invite league selection
  if (data.startsWith('admin:invite:league:')) {
    if (!admin) return;
    const leagueId = data.replace('admin:invite:league:', '');
    await handleInviteLeagueCallback(leagueId, chatId, msgId, user, db, env);
    return;
  }

  if (!data.startsWith('menu:')) return;
  const action = data.replace('menu:', '');

  switch (action) {
    case 'admin_result':
      if (admin) await startAdminResult(chatId, msgId, db, env);
      break;
    case 'admin_recalc':
      if (admin) await startAdminRecalculate(chatId, msgId, db, env);
      break;
    case 'admin_invite':
      if (admin) await generateInviteCode(chatId, msgId, user, db, env);
      break;
    case 'admin_league':
      if (admin) await startAdminLeague(chatId, user, db, env);
      break;
    case 'main': {
      await db.clearConversationState(user.telegram_id!);
      if (!admin) return;
      const name = user.username ?? undefined;
      const greeting = name ? `Hola, <b>${name}</b>! ` : '';
      await editMenu(
        env.TELEGRAM_BOT_TOKEN, chatId, msgId,
        `${greeting}🌍 <b>OraculoBot — Admin</b>\n\n¿Qué quieres hacer?`,
        buildAdminButtons()
      );
      break;
    }
  }
}
