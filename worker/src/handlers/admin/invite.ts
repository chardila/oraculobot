import type { Env, DbUser, DbLeague } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { editMenu } from '../../telegram';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % chars.length]).join('');
}

async function issueCode(
  leagueId: string,
  chatId: number,
  msgId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env,
  leagueName: string
): Promise<void> {
  const code = generateCode();

  await db.createInviteCode({
    code,
    created_by: user.id,
    max_uses: 1,
    league_id: leagueId,
  });

  const link = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${code}`;

  await editMenu(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    msgId,
    `🎟 <b>Código de invitación generado:</b>\n\n` +
    `Polla: <b>${leagueName}</b>\n` +
    `Código: <code>${code}</code>\n` +
    `Link: ${link}\n\n` +
    `(Uso único)`,
    [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
  );
}

export async function generateInviteCode(
  chatId: number,
  msgId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const leagues = await db.getLeagues();

  if (leagues.length === 0) {
    await editMenu(
      env.TELEGRAM_BOT_TOKEN, chatId, msgId,
      '❌ No hay pollas creadas. Crea una polla primero desde el menú admin.',
      [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
    );
    return;
  }

  if (leagues.length === 1) {
    await issueCode(leagues[0].id, chatId, msgId, user, db, env, leagues[0].name);
    return;
  }

  // Multiple leagues: show selection
  const buttons = leagues.map((l: DbLeague) => ([{
    text: l.name,
    callback_data: `admin:invite:league:${l.id}`,
  }]));
  buttons.push([{ text: '🔙 Menú', callback_data: 'menu:main' }]);

  await editMenu(
    env.TELEGRAM_BOT_TOKEN, chatId, msgId,
    '🎟 <b>¿Para cuál polla quieres generar el código?</b>',
    buttons
  );
}

export async function handleInviteLeagueCallback(
  leagueId: string,
  chatId: number,
  msgId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const leagues = await db.getLeagues();
  const league = leagues.find((l: DbLeague) => l.id === leagueId);
  if (!league) {
    await editMenu(
      env.TELEGRAM_BOT_TOKEN, chatId, msgId,
      '❌ Polla no encontrada.',
      [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
    );
    return;
  }
  await issueCode(leagueId, chatId, msgId, user, db, env, league.name);
}
