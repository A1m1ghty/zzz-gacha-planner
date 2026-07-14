import assert from "node:assert/strict";
import test from "node:test";
import { availablePulls, calculateHardPity, runSimulation } from "../app/lib/simulator.ts";
import type { SimulationConfig } from "../app/lib/types.ts";

function config(kind: "agent" | "engine"): SimulationConfig {
  return {
    schemaVersion: 1,
    resources: { polychrome: 159, monochrome: 0, encryptedTapes: 0, residualSignals: 0 },
    banners: {
      agent: { sPity: 0, guaranteedS: false, aPity: 0, guaranteedA: false },
      engine: { sPity: 0, guaranteedS: false, aPity: 0, guaranteedA: false },
    },
    ownership: {
      standardSBuckets: [6, 0, 0, 0, 0, 0, 0, 0],
      standardABuckets: [10, 0, 0, 0, 0, 0, 0, 0],
      trackedAAgents: { A1: 0, A2: 0 },
    },
    goals: [{
      id: "one",
      kind,
      name: "目标",
      currentOwned: 0,
      targetOwned: 1,
      specialGuarantee: false,
      featuredA: ["A1", "A2"],
    }],
    iterations: 2_000,
    seed: 12345,
  };
}

test("resource conversion floors partial pulls", () => {
  const value = config("agent");
  assert.equal(availablePulls(value), 0);
  value.resources.polychrome = 160;
  assert.equal(availablePulls(value), 1);
  value.resources.residualSignals = 20;
  assert.equal(availablePulls(value), 2);
});

test("normal and special hard pity bounds", () => {
  assert.equal(calculateHardPity(config("agent")), 180);
  assert.equal(calculateHardPity(config("engine")), 160);
  const specialAgent = config("agent");
  specialAgent.goals[0].specialGuarantee = true;
  assert.equal(calculateHardPity(specialAgent), 90);
  const specialEngine = config("engine");
  specialEngine.goals[0].specialGuarantee = true;
  assert.equal(calculateHardPity(specialEngine), 80);
});

test("pity 89 and 79 resolve on the next pull", () => {
  const agent = config("agent");
  agent.banners.agent.sPity = 89;
  agent.banners.agent.guaranteedS = true;
  assert.equal(calculateHardPity(agent), 1);
  const engine = config("engine");
  engine.banners.engine.sPity = 79;
  engine.banners.engine.guaranteedS = true;
  assert.equal(calculateHardPity(engine), 1);
});

test("fixed seed produces stable results and cashback never hurts", () => {
  const value = config("agent");
  value.resources.encryptedTapes = 100;
  const first = runSimulation(value);
  const second = runSimulation(value);
  assert.deepEqual(first.withCashback, second.withCashback);
  assert.equal(first.totalProbability, second.totalProbability);
  assert.ok(first.withCashback.mean <= first.withoutCashback.mean);
  assert.ok(first.withCashback.median <= first.withCashback.p80);
  assert.equal(first.distribution.reduce((sum, bin) => sum + bin.count, 0), first.iterations);
  assert.equal(first.distribution.reduce((sum, bin) => sum + bin.successful, 0), first.successSamples);
  assert.equal(first.distribution.at(-1)?.cumulative, 1);
});
