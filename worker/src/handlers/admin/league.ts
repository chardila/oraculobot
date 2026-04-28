import type { TelegramMessage, Env, DbUser, ConversationState } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { sendMessage } from '../../telegram';

export async function startAdminLeague(
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  await db.setConversationState(user.telegram_id!, 'awaiting_league_name', {});
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    '➕ <b>Nueva polla</b>\n\nEscribe el nombre de la polla (ej: "Polla Familia"):');
}

export async function handleAdminLeagueText(
  msg: TelegramMessage,
  _state: ConversationState,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const chatId = msg.chat.id;
  const name = msg.text?.trim() ?? '';

  if (!name || name.startsWith('/')) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      '❌ Nombre inválido. Escribe el nombre de la polla o envía /cancel para salir.');
    return;
  }

  const league = await db.createLeague(name);
  await db.clearConversationState(user.telegram_id!);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ <b>Polla creada:</b> ${league.name}\n\n` +
    `ID: <code>${league.id}</code>\n\n` +
    `Ahora puedes generar códigos de invitación para esta polla desde el menú admin.`);
}
