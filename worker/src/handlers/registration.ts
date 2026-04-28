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

  const isAdmin = String(telegramId) === env.ADMIN_TELEGRAM_ID;

  if (!isAdmin) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '👋 Para participar en OraculoBot entra al sitio web con tu código de invitación.');
    return;
  }

  if (!text || text.length < 4) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '👋 Hola, admin. Usa el menú para gestionar la polla.');
    return;
  }

  const code = text.toUpperCase();
  const inviteCode = await db.getInviteCode(code);
  if (!inviteCode) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Código inválido o ya no es válido.');
    return;
  }

  const consumed = await db.tryConsumeInviteCode(code);
  if (!consumed) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Código inválido o ya no es válido.');
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
    `✅ ¡Registrado! Bienvenido, <b>${fullName}</b>.`);

  await showMainMenu(chatId, isAdmin, env, fullName);
}
