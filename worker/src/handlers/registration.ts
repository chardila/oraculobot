import type { TelegramMessage, Env } from '../types';
import type { SupabaseClient } from '../supabase';
import { sendMessage } from '../telegram';

// Forward declaration to avoid circular import — menu imports registration, registration shows menu
type ShowMainMenuFn = (chatId: number, isAdmin: boolean, env: Env) => Promise<void>;

export async function handleRegistration(
  msg: TelegramMessage,
  db: SupabaseClient,
  env: Env,
  showMainMenu: ShowMainMenuFn
): Promise<void> {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const text = msg.text?.trim() ?? '';

  if (!text || text.length < 4) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '👋 Bienvenido a OraculoBot.\n\nPara participar, envía tu <b>código de invitación</b>.');
    return;
  }

  const code = await db.getInviteCode(text.toUpperCase());

  if (!code) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Código inválido. Pide a quien te invitó que te reenvíe el código.');
    return;
  }

  if (code.use_count >= code.max_uses) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Este código ya no es válido.');
    return;
  }

  await db.createUser({
    telegram_id: telegramId,
    username: msg.from.username ?? msg.from.first_name,
    is_admin: false,
    invite_code: code.code,
  });

  await db.incrementInviteCodeUse(code.code);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ ¡Registrado! Bienvenido al torneo, <b>${msg.from.first_name}</b>.`);

  const isAdmin = String(telegramId) === env.ADMIN_TELEGRAM_ID;
  await showMainMenu(chatId, isAdmin, env);
}
