import type { TelegramMessage, Env, DbUser, ConversationState } from '../../types';
import type { SupabaseClient } from '../../supabase';
import { sendMessage } from '../../telegram';

export async function startAdminMatch(
  chatId: number,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  await db.setConversationState(user.telegram_id, 'awaiting_match_home_team', {});
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    '➕ <b>Nuevo partido</b>\n\nEscribe el nombre del equipo <b>local</b>:');
}

const VALID_PHASES = ['grupos', 'octavos', 'cuartos', 'semis', 'final'];

export async function handleAdminMatchText(
  msg: TelegramMessage,
  state: ConversationState,
  user: DbUser,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? '';
  const ctx = state.context as Record<string, string | null>;

  switch (state.step) {
    case 'awaiting_match_home_team':
      await db.setConversationState(user.telegram_id, 'awaiting_match_away_team',
        { home_team: text });
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Equipo <b>visitante</b>:');
      break;

    case 'awaiting_match_away_team':
      await db.setConversationState(user.telegram_id, 'awaiting_match_kickoff',
        { ...ctx, away_team: text });
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        'Fecha y hora del partido (hora Colombia, UTC-5):\n' +
        'Ejemplo: <code>2026-06-15T18:00:00-05:00</code>');
      break;

    case 'awaiting_match_kickoff': {
      const kickoff = new Date(text);
      if (isNaN(kickoff.getTime())) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
          '❌ Fecha inválida. Usa formato ISO, ej: <code>2026-06-15T18:00:00-05:00</code>');
        return;
      }
      await db.setConversationState(user.telegram_id, 'awaiting_match_phase',
        { ...ctx, kickoff_at: kickoff.toISOString() });
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        'Fase del partido:\n<code>grupos</code> / <code>octavos</code> / <code>cuartos</code> / <code>semis</code> / <code>final</code>');
      break;
    }

    case 'awaiting_match_phase': {
      const phase = text.toLowerCase();
      if (!VALID_PHASES.includes(phase)) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
          '❌ Fase inválida. Opciones: grupos, octavos, cuartos, semis, final');
        return;
      }
      if (phase === 'grupos') {
        await db.setConversationState(user.telegram_id, 'awaiting_match_group',
          { ...ctx, phase });
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Grupo (A-L):');
      } else {
        await createMatch({ ...ctx, phase, group_name: null }, user, db, env, chatId);
      }
      break;
    }

    case 'awaiting_match_group':
      await createMatch({ ...ctx, group_name: text.toUpperCase() }, user, db, env, chatId);
      break;
  }
}

async function createMatch(
  ctx: Record<string, string | null>,
  user: DbUser,
  db: SupabaseClient,
  env: Env,
  chatId: number
): Promise<void> {
  await db.createMatch({
    home_team: ctx.home_team as string,
    away_team: ctx.away_team as string,
    kickoff_at: ctx.kickoff_at as string,
    phase: ctx.phase as string,
    group_name: ctx.group_name ?? null,
  });

  await db.clearConversationState(user.telegram_id);

  const date = new Date(ctx.kickoff_at as string).toLocaleString('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ Partido creado:\n<b>${ctx.home_team} vs ${ctx.away_team}</b>\n` +
    `Fase: ${ctx.phase}${ctx.group_name ? ` | Grupo ${ctx.group_name}` : ''}\n` +
    `Kickoff: ${date}`
  );
}
