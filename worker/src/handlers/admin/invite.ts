import type { Env, DbUser } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { editMenu } from '../../telegram';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % chars.length]).join('');
}

export async function generateInviteCode(
  chatId: number,
  msgId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const code = generateCode();

  await db.createInviteCode({
    code,
    created_by: user.id,
    max_uses: 1,
  });

  const link = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${code}`;

  await editMenu(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    msgId,
    `🎟 <b>Código de invitación generado:</b>\n\n` +
    `Código: <code>${code}</code>\n` +
    `Link: ${link}\n\n` +
    `(Uso único)`,
    [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
  );
}
