interface Score {
  home: number;
  away: number;
}

export function calculatePoints(prediction: Score, result: Score): number {
  const isExact =
    prediction.home === result.home && prediction.away === result.away;
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
