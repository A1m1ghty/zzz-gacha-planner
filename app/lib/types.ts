export type GoalKind = "agent" | "engine";

export interface ResourceState {
  polychrome: number;
  monochrome: number;
  encryptedTapes: number;
  residualSignals: number;
}

export interface BannerState {
  sPity: number;
  guaranteedS: boolean;
  aPity: number;
  guaranteedA: boolean;
}

export interface OwnershipProfile {
  standardSBuckets: number[];
  standardABuckets: number[];
  trackedAAgents: Record<string, number>;
}

export interface PullGoal {
  id: string;
  groupId?: string;
  kind: GoalKind;
  name: string;
  currentOwned: number;
  targetOwned: number;
  specialGuarantee: boolean;
  featuredA: [string, string];
}

export interface SimulationConfig {
  schemaVersion: 1;
  resources: ResourceState;
  banners: Record<GoalKind, BannerState>;
  ownership: OwnershipProfile;
  goals: PullGoal[];
  iterations: number;
  seed: number;
}

export interface RequirementStats {
  mean: number;
  p80: number;
  p90: number;
  p95: number;
}

export interface SimulationResult {
  iterations: number;
  availablePulls: number;
  totalProbability: number;
  totalProbabilityWithoutCashback: number;
  standardError: number;
  goalProbabilities: Array<{
    id: string;
    name: string;
    probability: number;
  }>;
  withCashback: RequirementStats;
  withoutCashback: RequirementStats;
  hardPityPulls: number;
  generatedRefundPullsMean: number;
  elapsedMs: number;
}

export interface SavedPlannerState {
  schemaVersion: 1;
  resources: ResourceState;
  banners: Record<GoalKind, BannerState>;
  ownership: OwnershipProfile;
  goals: PullGoal[];
}
