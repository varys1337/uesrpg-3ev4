export function getRoundTimeSecondsSafe() {
  try {
    const roundTime = Number(CONFIG?.time?.roundTime ?? 6);
    return Number.isFinite(roundTime) && roundTime > 0 ? roundTime : 6;
  } catch (_err) {
    return 6;
  }
}
