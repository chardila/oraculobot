import type { TelegramMessage, Env } from '../types';
import type { SupabaseClient } from '../supabase';
import { sendMessage } from '../telegram';

type ShowMainMenuFn = (chatId: number, isAdmin: boolean, env: Env, name?: string) => Promise<void>;

export function extractInviteCode(text: string): string {
  return text.startsWith('/start ') ? text.slice(7).trim() : text;
}

export async function handleRegistration(
  msg: TelegramMessage,
  db: SupabaseClient,
  env: Env,
  showMainMenu: ShowMainMenuFn
): Promise<void> {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
  const raw = msg.text?.trim() ?? '';
  const text = extractInviteCode(raw);

  if (!text || text.length < 4) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '👋 Bienvenido a OraculoBot.\n\nPara participar, envía tu <b>código de invitación</b>.');
    return;
  }

  const code = text.toUpperCase();
  const inviteCode = await db.getInviteCode(code);
  if (!inviteCode) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Código inválido o ya no es válido. Pide a quien te invitó que te reenvíe el código.');
    return;
  }

  const consumed = await db.tryConsumeInviteCode(code);
  if (!consumed) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Código inválido o ya no es válido. Pide a quien te invitó que te reenvíe el código.');
    return;
  }

  await db.createUser({
    telegram_id: telegramId,
    username: msg.from.username ?? fullName,
    invite_code: code,
    league_id: inviteCode.league_id,
    questions_today: 0,
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ ¡Registrado! Bienvenido al torneo, <b>${fullName}</b>.`);

  const isAdmin = String(telegramId) === env.ADMIN_TELEGRAM_ID;
  await showMainMenu(chatId, isAdmin, env, fullName);
}
