import type { Env } from '../types';
import type { SupabaseClient } from '../supabase';
import { editMenu } from '../telegram';

const MEDALS = ['🥇', '🥈', '🥉'];

export async function showRanking(
  chatId: number,
  msgId: number,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const rows = await db.getLeaderboard();

  let text = '📊 <b>Ranking — Mundial 2026</b>\n\n';
  if (rows.length === 0) {
    text += 'Aún no hay puntos registrados.';
  } else {
    rows.slice(0, 15).forEach((row, i) => {
      const medal = MEDALS[i] ?? `${i + 1}.`;
      text += `${medal} ${row.username ?? 'Anónimo'} — <b>${row.total_points} pts</b>\n`;
    });
  }

  await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId, text,
    [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
  );
}
