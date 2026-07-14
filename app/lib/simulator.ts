import {
  BANNER_RULES,
  POLYCHROME_PER_PULL,
  RESIDUAL_PER_TAPE,
  sRankRate,
} from "./rules.ts";
import type {
  BannerState,
  DistributionBin,
  GoalKind,
  OwnershipProfile,
  RequirementStats,
  SimulationConfig,
  SimulationResult,
} from "./types.ts";

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

const cloneBanner = (state: BannerState): BannerState => ({ ...state });

function normalizedBuckets(source: number[]) {
  const buckets = Array.from({ length: 8 }, (_, index) =>
    Math.max(0, Math.floor(source[index] ?? 0)),
  );
  if (!buckets.some(Boolean)) buckets[0] = 1;
  return buckets;
}

function pullFromBuckets(
  buckets: number[],
  rng: () => number,
  rarity: "A" | "S",
) {
  const total = buckets.reduce((sum, count) => sum + count, 0);
  let cursor = rng() * total;
  let bucket = 0;
  for (; bucket < buckets.length; bucket += 1) {
    cursor -= buckets[bucket];
    if (cursor < 0) break;
  }
  bucket = Math.min(bucket, 7);
  const residual =
    bucket === 0 ? 0 : bucket >= 7 ? (rarity === "S" ? 100 : 20) : rarity === "S" ? 40 : 8;
  if (bucket < 7) {
    buckets[bucket] -= 1;
    buckets[bucket + 1] += 1;
  }
  return residual;
}

function trackedAgentResidual(owned: number, rarity: "A" | "S") {
  if (owned <= 0) return 0;
  if (owned >= 7) return rarity === "S" ? 100 : 20;
  return rarity === "S" ? 40 : 8;
}

function requirementStats(values: number[]): RequirementStats {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0;
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
    median: pick(0.5),
    p80: pick(0.8),
    p90: pick(0.9),
    p95: pick(0.95),
  };
}

function quantile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function distributionStats(values: number[], currentPulls: number): DistributionBin[] {
  if (!values.length) return [];
  let minValue = values[0];
  let maxValue = values[0];
  values.forEach((value) => {
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
  });

  const roughBinSize = Math.max(10, (maxValue - minValue + 1) / 18);
  const binSize = Math.ceil(roughBinSize / 10) * 10;
  const firstMin = Math.floor(minValue / binSize) * binSize;
  const binCount = Math.floor((maxValue - firstMin) / binSize) + 1;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    min: firstMin + index * binSize,
    max: firstMin + (index + 1) * binSize - 1,
    count: 0,
    successful: 0,
  }));

  values.forEach((value) => {
    const bin = bins[Math.min(bins.length - 1, Math.floor((value - firstMin) / binSize))];
    bin.count += 1;
    if (value <= currentPulls) bin.successful += 1;
  });

  let cumulative = 0;
  return bins.filter((bin) => bin.count > 0).map((bin) => {
    cumulative += bin.count;
    return {
      ...bin,
      probability: bin.count / values.length,
      cumulative: cumulative / values.length,
    };
  });
}

export function availablePulls(config: Pick<SimulationConfig, "resources">) {
  const { resources } = config;
  return (
    Math.max(0, Math.floor(resources.encryptedTapes)) +
    Math.floor(
      (Math.max(0, resources.polychrome) + Math.max(0, resources.monochrome)) /
        POLYCHROME_PER_PULL,
    ) +
    Math.floor(Math.max(0, resources.residualSignals) / RESIDUAL_PER_TAPE)
  );
}

function simulateOne(
  config: SimulationConfig,
  rng: () => number,
): { required: number; gross: number; goalRequired: number[]; refundPulls: number } {
  const banners: Record<GoalKind, BannerState> = {
    agent: cloneBanner(config.banners.agent),
    engine: cloneBanner(config.banners.engine),
  };
  const ownership: OwnershipProfile = {
    standardSBuckets: normalizedBuckets(config.ownership.standardSBuckets),
    standardABuckets: normalizedBuckets(config.ownership.standardABuckets),
    trackedAAgents: { ...config.ownership.trackedAAgents },
  };
  let residual = Math.max(0, Math.floor(config.resources.residualSignals)) % RESIDUAL_PER_TAPE;
  let refundPulls = 0;
  let gross = 0;
  let required = 0;
  const goalRequired: number[] = [];

  const addResidual = (amount: number) => {
    residual += amount;
    while (residual >= RESIDUAL_PER_TAPE) {
      residual -= RESIDUAL_PER_TAPE;
      refundPulls += 1;
    }
  };

  for (const goal of config.goals) {
    let owned = Math.max(0, Math.floor(goal.currentOwned));
    const target = Math.max(owned, Math.floor(goal.targetOwned));
    let specialAvailable = goal.specialGuarantee;
    const banner = banners[goal.kind];
    const rule = BANNER_RULES[goal.kind];

    while (owned < target) {
      gross += 1;
      required = Math.max(required, gross - refundPulls);
      const nextS = banner.sPity + 1;
      const isS = rng() < sRankRate(goal.kind, nextS);

      if (isS) {
        banner.sPity = 0;
        banner.aPity = 0;
        let targetHit = false;
        if (specialAvailable) {
          targetHit = true;
          specialAvailable = false;
        } else if (banner.guaranteedS || rng() < rule.featuredSRate) {
          targetHit = true;
          banner.guaranteedS = false;
        } else {
          banner.guaranteedS = true;
        }

        if (targetHit) {
          if (goal.kind === "agent") addResidual(trackedAgentResidual(owned, "S"));
          else addResidual(40);
          owned += 1;
        } else if (goal.kind === "agent") {
          addResidual(pullFromBuckets(ownership.standardSBuckets, rng, "S"));
        } else {
          addResidual(40);
        }
        continue;
      }

      banner.sPity += 1;
      const guaranteedA = banner.aPity >= 9;
      const adjustedARate = Math.min(1, rule.baseARate / Math.max(0.000001, 1 - sRankRate(goal.kind, nextS)));
      const isA = guaranteedA || rng() < adjustedARate;

      if (!isA) {
        banner.aPity += 1;
        continue;
      }

      banner.aPity = 0;
      const featured = banner.guaranteedA || rng() < rule.featuredARate;
      if (featured) {
        banner.guaranteedA = false;
        if (goal.kind === "engine") {
          addResidual(8);
        } else {
          const name = goal.featuredA[rng() < 0.5 ? 0 : 1]?.trim() || "未命名UP A级";
          const current = ownership.trackedAAgents[name] ?? 0;
          addResidual(trackedAgentResidual(current, "A"));
          ownership.trackedAAgents[name] = Math.min(7, current + 1);
        }
      } else {
        banner.guaranteedA = true;
        if (rng() < 0.5) addResidual(pullFromBuckets(ownership.standardABuckets, rng, "A"));
        else addResidual(8);
      }
    }
    goalRequired.push(required);
  }

  return { required, gross, goalRequired, refundPulls };
}

export function calculateHardPity(config: Pick<SimulationConfig, "goals" | "banners">) {
  const banners: Record<GoalKind, BannerState> = {
    agent: cloneBanner(config.banners.agent),
    engine: cloneBanner(config.banners.engine),
  };
  let pulls = 0;
  for (const goal of config.goals) {
    const banner = banners[goal.kind];
    const hard = BANNER_RULES[goal.kind].hardPity;
    let special = goal.specialGuarantee;
    const copies = Math.max(0, Math.floor(goal.targetOwned) - Math.floor(goal.currentOwned));
    for (let copy = 0; copy < copies; copy += 1) {
      const firstS = hard - banner.sPity;
      if (special) {
        pulls += firstS;
        special = false;
      } else if (banner.guaranteedS) {
        pulls += firstS;
        banner.guaranteedS = false;
      } else {
        pulls += firstS + hard;
        banner.guaranteedS = false;
      }
      banner.sPity = 0;
    }
  }
  return pulls;
}

export function runSimulation(config: SimulationConfig): SimulationResult {
  const started = Date.now();
  const iterations = Math.max(1, Math.floor(config.iterations));
  const rng = mulberry32(config.seed);
  const currentPulls = availablePulls(config);
  const requiredValues: number[] = [];
  const grossValues: number[] = [];
  const goalSuccess = config.goals.map(() => 0);
  let success = 0;
  let successWithoutCashback = 0;
  let refundTotal = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const path = simulateOne(config, rng);
    requiredValues.push(path.required);
    grossValues.push(path.gross);
    refundTotal += path.refundPulls;
    if (path.required <= currentPulls) success += 1;
    if (path.gross <= currentPulls) successWithoutCashback += 1;
    path.goalRequired.forEach((needed, index) => {
      if (needed <= currentPulls) goalSuccess[index] += 1;
    });
  }

  const probability = success / iterations;
  const successfulRequirements = requiredValues.filter((value) => value <= currentPulls);
  return {
    iterations,
    availablePulls: currentPulls,
    totalProbability: probability,
    totalProbabilityWithoutCashback: successWithoutCashback / iterations,
    standardError: Math.sqrt((probability * (1 - probability)) / iterations),
    successSamples: success,
    successRequiredMedian: quantile(successfulRequirements, 0.5),
    goalProbabilities: config.goals.map((goal, index) => ({
      id: goal.id,
      name: goal.name,
      probability: goalSuccess[index] / iterations,
    })),
    withCashback: requirementStats(requiredValues),
    withoutCashback: requirementStats(grossValues),
    hardPityPulls: calculateHardPity(config),
    generatedRefundPullsMean: refundTotal / iterations,
    distribution: distributionStats(requiredValues, currentPulls),
    elapsedMs: Date.now() - started,
  };
}
