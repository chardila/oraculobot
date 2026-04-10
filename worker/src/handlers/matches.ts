import type { Env, DbMatch } from '../types';
import type { SupabaseClient } from '../supabase';
import { editMenu } from '../telegram';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Bogota',
  });
}

function formatMatchPhase(match: DbMatch): string {
  const labels: Record<string, string> = {
    grupos: 'Grupos', octavos: 'Octavos',
    cuartos: 'Cuartos', semis: 'Semis', final: 'Final',
  };
  const label = labels[match.phase] ?? match.phase;
  return match.group_name ? `${label} • Grupo ${match.group_name}` : label;
}

export async function showMatches(
  chatId: number,
  msgId: number,
  db: SupabaseClient,
  env: Env
): Promise<void> {
  const [upcoming, recent] = await Promise.all([
    db.getUpcomingMatches(0),
    db.getRecentFinished(5),
  ]);

  let text = '📅 <b>Partidos</b>\n\n';

  if (recent.length > 0) {
    text += '<b>Resultados recientes:</b>\n';
    recent.forEach(m => {
      text += `${m.home_team} <b>${m.home_score}-${m.away_score}</b> ${m.away_team}\n`;
    });
    text += '\n';
  }

  if (upcoming.length > 0) {
    text += '<b>Próximos partidos:</b>\n';
    upcoming.slice(0, 5).forEach(m => {
      text += `${formatMatchPhase(m)} | ${m.home_team} vs ${m.away_team} — ${formatDate(m.kickoff_at)}\n`;
    });
  }

  if (recent.length === 0 && upcoming.length === 0) {
    text += 'No hay partidos registrados aún.';
  }

  await editMenu(env.TELEGRAM_BOT_TOKEN, chatId, msgId, text,
    [[{ text: '🔙 Menú', callback_data: 'menu:main' }]]
  );
}
