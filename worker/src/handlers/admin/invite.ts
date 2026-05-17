import type { Env, DbUser, DbLeague } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { editMenu, sendMessage } from '../../telegram';

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

  const link = `${env.WEB_ORIGIN}/jugar.html?code=${code}`;

  await editMenu(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    msgId,
    `🎟 <b>Código de invitación generado:</b>\n\n` +
    `Polla: <b>${leagueName}</b>\n` +
    `Código: <code>${code}</code>\n` +
    `Link: ${link}\n\n` +
    `(Uso único — copia el texto de abajo para enviar al invitado)`,
    [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
  );

  const emailBody =
    `Asunto: Invitación al Oráculo del Mundial 2026 🔮\n\n` +
    `Hola,\n\n` +
    `Te invito a participar en la polla del Mundial 2026 en OraculoBot — predice los marcadores de cada partido y compite en el ranking.\n\n` +
    `── Cómo registrarte ──\n\n` +
    `1. Abre este enlace (incluye tu código): ${link}\n` +
    `2. Escribe tu correo y el nombre con el que aparecerás en el ranking.\n` +
    `3. Haz clic en "Registrarme →"\n` +
    `4. Te llegará un enlace mágico al correo — solo haz clic para entrar. Sin contraseña.\n\n` +
    `⚠️ El enlace es de uso único.\n\n` +
    `── Cómo predecir ──\n\n` +
    `Toca 🔮 Predecir, elige el partido, escribe el marcador (ej. 2 - 1) y confirma.\n` +
    `⏰ Las predicciones cierran 5 minutos antes del pitazo.\n\n` +
    `── Puntos ──\n\n` +
    `• Marcador exacto: 5 pts\n` +
    `• Resultado correcto (ganador/empate): 3 pts\n` +
    `• Diferencia de goles correcta: +1 pt\n\n` +
    `── Para volver a entrar ──\n\n` +
    `Selecciona "¿Ya tienes cuenta?" y escribe tu correo. Te llegará un nuevo enlace mágico.\n\n` +
    `¡Buena suerte!`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `<pre>${emailBody}</pre>`);
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
