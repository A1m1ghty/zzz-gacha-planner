import type { GoalKind } from "./types";

export const RULE_VERSION = "3.0 / 2026-07-12";
export const POLYCHROME_PER_PULL = 160;
export const RESIDUAL_PER_TAPE = 20;

export const BANNER_RULES: Record<
  GoalKind,
  {
    hardPity: number;
    baseSRate: number;
    softPityStart: number;
    softPityIncrease: number;
    featuredSRate: number;
    baseARate: number;
    featuredARate: number;
  }
> = {
  agent: {
    hardPity: 90,
    baseSRate: 0.006,
    softPityStart: 74,
    softPityIncrease: 0.06,
    featuredSRate: 0.5,
    baseARate: 0.094,
    featuredARate: 0.5,
  },
  engine: {
    hardPity: 80,
    baseSRate: 0.01,
    softPityStart: 65,
    softPityIncrease: 0.07,
    featuredSRate: 0.75,
    baseARate: 0.15,
    featuredARate: 0.75,
  },
};

export function sRankRate(kind: GoalKind, pullSinceS: number) {
  const rule = BANNER_RULES[kind];
  if (pullSinceS >= rule.hardPity) return 1;
  if (pullSinceS < rule.softPityStart) return rule.baseSRate;
  return Math.min(
    1,
    rule.baseSRate +
      (pullSinceS - rule.softPityStart + 1) * rule.softPityIncrease,
  );
}
