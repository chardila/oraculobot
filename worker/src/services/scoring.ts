interface Score {
  home: number;
  away: number;
}

export interface PointsBreakdown {
  result: number;
  diff: number;
  home: number;
  away: number;
  total: number;
  multiplier: number;
}

const KNOCKOUT_MULTIPLIERS: Record<string, number> = {
  treintaidosavos: 2,
  octavos: 4,
  cuartos: 6,
  semis: 8,
  tercer_lugar: 4,
  final: 10,
};

function getKnockoutComponents(prediction: Score, result: Score) {
  const predDiff = Math.abs(prediction.home - prediction.away);
  const actualDiff = Math.abs(result.home - result.away);
  const predResult = Math.sign(prediction.home - prediction.away);
  const actualResult = Math.sign(result.home - result.away);

  const resultCorrect = predResult === actualResult;
  return {
    result: resultCorrect ? 2 : 0,
    diff: (resultCorrect && predDiff === actualDiff) ? 1 : 0,
    home: prediction.home === result.home ? 1 : 0,
    away: prediction.away === result.away ? 1 : 0,
  };
}

export function calculatePoints(prediction: Score, result: Score, phase?: string): number {
  if (phase && phase !== 'grupos') {
    const multiplier = KNOCKOUT_MULTIPLIERS[phase] ?? 1;
    const c = getKnockoutComponents(prediction, result);
    return (c.result + c.diff + c.home + c.away) * multiplier;
  }

  const isExact = prediction.home === result.home && prediction.away === result.away;
  if (isExact) return 5;

  const predResult = Math.sign(prediction.home - prediction.away);
  const actualResult = Math.sign(result.home - result.away);
  const correctResult = predResult === actualResult;

  const predDiff = Math.abs(prediction.home - prediction.away);
  const actualDiff = Math.abs(result.home - result.away);
  const correctDiff = predDiff === actualDiff;

  let points = 0;
  if (correctResult) points += 3;
  if (correctDiff) points += 1;
  return points;
}

export function calculatePointsBreakdown(prediction: Score, result: Score, phase?: string): PointsBreakdown {
  if (phase && phase !== 'grupos') {
    const multiplier = KNOCKOUT_MULTIPLIERS[phase] ?? 1;
    const c = getKnockoutComponents(prediction, result);
    return {
      result: c.result * multiplier,
      diff: c.diff * multiplier,
      home: c.home * multiplier,
      away: c.away * multiplier,
      total: (c.result + c.diff + c.home + c.away) * multiplier,
      multiplier,
    };
  }
  return { result: 0, diff: 0, home: 0, away: 0, total: calculatePoints(prediction, result), multiplier: 1 };
}
