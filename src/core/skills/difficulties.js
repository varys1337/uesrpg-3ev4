export const SKILL_DIFFICULTIES = Object.freeze([
  { key: "effortless", label: "Effortless", mod: 40 },
  { key: "simple", label: "Simple", mod: 30 },
  { key: "easy", label: "Easy", mod: 20 },
  { key: "ordinary", label: "Ordinary", mod: 10 },
  { key: "average", label: "Average", mod: 0 },
  { key: "challenging", label: "Challenging", mod: -10 },
  { key: "difficult", label: "Difficult", mod: -20 },
  { key: "hard", label: "Hard", mod: -30 },
  { key: "veryHard", label: "Very Hard", mod: -40 },
]);

export function getDifficultyByKey(key) {
  return SKILL_DIFFICULTIES.find((difficulty) => difficulty.key === key)
    ?? SKILL_DIFFICULTIES.find((difficulty) => difficulty.key === "average");
}
