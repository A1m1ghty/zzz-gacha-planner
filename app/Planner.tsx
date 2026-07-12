"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { POLYCHROME_PER_PULL, RULE_VERSION } from "./lib/rules";
import type {
  BannerState,
  GoalKind,
  PullGoal,
  SavedPlannerState,
  SimulationConfig,
  SimulationResult,
} from "./lib/types";

const STORAGE_KEY = "new-eridu-signal-planner-v1";
const BUCKET_LABELS = ["未持有", "M0", "M1", "M2", "M3", "M4", "M5", "M6+"];

const freshBanner = (): BannerState => ({
  sPity: 0,
  guaranteedS: false,
  aPity: 0,
  guaranteedA: false,
});

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createGoal = (kind: GoalKind): PullGoal => ({
  id: newId(),
  kind,
  name: kind === "agent" ? "目标代理人" : "目标音擎",
  currentOwned: 0,
  targetOwned: 1,
  specialGuarantee: false,
  featuredA: kind === "agent" ? ["UP A级代理人 1", "UP A级代理人 2"] : ["UP A级音擎 1", "UP A级音擎 2"],
});

const createDefaultState = (): SavedPlannerState => ({
  schemaVersion: 1,
  resources: {
    polychrome: 12800,
    monochrome: 0,
    encryptedTapes: 10,
    residualSignals: 0,
  },
  banners: { agent: freshBanner(), engine: freshBanner() },
  ownership: {
    standardSBuckets: [2, 2, 1, 1, 0, 0, 0, 0],
    standardABuckets: [4, 4, 2, 1, 0, 0, 0, 0],
    trackedAAgents: {
      "UP A级代理人 1": 1,
      "UP A级代理人 2": 1,
    },
  },
  goals: [createGoal("agent"), createGoal("engine")],
});

function clampNumber(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function validateImported(value: unknown): SavedPlannerState {
  if (!value || typeof value !== "object") throw new Error("文件不是有效的规划数据。 ");
  const candidate = value as Partial<SavedPlannerState>;
  if (candidate.schemaVersion !== 1) throw new Error("不支持这个数据版本，请导入 v1 文件。 ");
  if (!candidate.resources || !candidate.banners || !candidate.ownership || !Array.isArray(candidate.goals)) {
    throw new Error("文件缺少资源、保底、账号画像或目标清单。 ");
  }
  const state = candidate as SavedPlannerState;
  return {
    ...state,
    resources: {
      polychrome: clampNumber(state.resources.polychrome, 0, 99_999_999),
      monochrome: clampNumber(state.resources.monochrome, 0, 99_999_999),
      encryptedTapes: clampNumber(state.resources.encryptedTapes, 0, 999_999),
      residualSignals: clampNumber(state.resources.residualSignals, 0, 9_999_999),
    },
    banners: {
      agent: {
        ...state.banners.agent,
        sPity: clampNumber(state.banners.agent.sPity, 0, 89),
        aPity: clampNumber(state.banners.agent.aPity, 0, 9),
      },
      engine: {
        ...state.banners.engine,
        sPity: clampNumber(state.banners.engine.sPity, 0, 79),
        aPity: clampNumber(state.banners.engine.aPity, 0, 9),
      },
    },
    goals: state.goals.map((goal) => ({
      ...goal,
      id: goal.id || newId(),
      name: String(goal.name || "未命名目标"),
      kind: goal.kind === "engine" ? "engine" : "agent",
      currentOwned: clampNumber(goal.currentOwned, 0, goal.kind === "engine" ? 5 : 7),
      targetOwned: clampNumber(goal.targetOwned, 1, goal.kind === "engine" ? 5 : 7),
      featuredA: [String(goal.featuredA?.[0] || "UP A级 1"), String(goal.featuredA?.[1] || "UP A级 2")],
    })),
  };
}

function NumberInput({
  label,
  value,
  min = 0,
  max = 99_999_999,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-shell">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(clampNumber(event.target.value, min, max))}
        />
        {suffix && <small>{suffix}</small>}
      </span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

function pct(value: number) {
  if (value >= 0.99995) return "≈100%";
  if (value <= 0.00005) return "<0.01%";
  return `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`;
}

function pullLabel(value: number) {
  return `${Math.ceil(value).toLocaleString("zh-CN")} 抽`;
}

export default function Planner() {
  const [state, setState] = useState<SavedPlannerState>(() => createDefaultState());
  const [hydrated, setHydrated] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("正在准备概率模型…");
  const [importError, setImportError] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const runTokenRef = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setState(validateImported(JSON.parse(saved)));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  const simulationConfig = useCallback(
    (iterations: number): SimulationConfig => ({
      ...state,
      iterations,
      seed: 0x5a17e202,
    }),
    [state],
  );

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    runTokenRef.current += 1;
    setIsRunning(false);
  }, []);

  const run = useCallback(
    (iterations: number, label: string) => {
      stopWorker();
      if (!state.goals.length) {
        setResult(null);
        setStatus("请先添加至少一个抽取目标。 ");
        return;
      }
      const token = runTokenRef.current;
      const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      setIsRunning(true);
      setStatus(`${label}：正在运行 ${iterations.toLocaleString("zh-CN")} 次模拟…`);
      worker.onmessage = (event) => {
        if (token !== runTokenRef.current) return;
        setIsRunning(false);
        workerRef.current = null;
        worker.terminate();
        if (event.data.ok) {
          setResult(event.data.result);
          setStatus(`${label}完成 · ${event.data.result.elapsedMs.toLocaleString("zh-CN")} ms`);
        } else {
          setStatus(event.data.error || "计算失败，请检查输入。 ");
        }
      };
      worker.onerror = () => {
        if (token !== runTokenRef.current) return;
        setIsRunning(false);
        setStatus("后台计算失败，请刷新页面后重试。 ");
      };
      worker.postMessage(simulationConfig(iterations));
    },
    [simulationConfig, state.goals.length, stopWorker],
  );

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => run(20_000, "快速预览"), 450);
    return () => window.clearTimeout(timer);
  }, [hydrated, state, run]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const currentResourcePulls = useMemo(
    () =>
      state.resources.encryptedTapes +
      Math.floor((state.resources.polychrome + state.resources.monochrome) / 160) +
      Math.floor(state.resources.residualSignals / 20),
    [state.resources],
  );

  const updateBanner = (kind: GoalKind, patch: Partial<BannerState>) =>
    setState((current) => ({
      ...current,
      banners: { ...current.banners, [kind]: { ...current.banners[kind], ...patch } },
    }));

  const updateGoal = (id: string, patch: Partial<PullGoal>) =>
    setState((current) => ({
      ...current,
      goals: current.goals.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal)),
    }));

  const moveGoal = (id: string, direction: -1 | 1) =>
    setState((current) => {
      const index = current.goals.findIndex((goal) => goal.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.goals.length) return current;
      const goals = [...current.goals];
      [goals[index], goals[target]] = [goals[target], goals[index]];
      return { ...current, goals };
    });

  const dropGoal = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setState((current) => {
      const goals = [...current.goals];
      const from = goals.findIndex((goal) => goal.id === draggedId);
      const to = goals.findIndex((goal) => goal.id === targetId);
      if (from < 0 || to < 0) return current;
      const [moved] = goals.splice(from, 1);
      goals.splice(to, 0, moved);
      return { ...current, goals };
    });
    setDraggedId(null);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `绝区零抽卡规划-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file: File | undefined) => {
    if (!file) return;
    try {
      const next = validateImported(JSON.parse(await file.text()));
      setState(next);
      setImportError("");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "导入失败。 ");
    }
  };

  const reset = () => {
    if (!window.confirm("确定清空当前规划并恢复示例数据吗？")) return;
    stopWorker();
    setState(createDefaultState());
    setResult(null);
  };

  const renderBanner = (kind: GoalKind, title: string) => {
    const banner = state.banners[kind];
    const hard = kind === "agent" ? 90 : 80;
    return (
      <div className="banner-card">
        <div className="card-title-row">
          <span className={`kind-mark ${kind}`}>{kind === "agent" ? "A" : "W"}</span>
          <div>
            <h3>{title}</h3>
            <p>S级与A级计数互相独立</p>
          </div>
        </div>
        <div className="two-columns">
          <NumberInput
            label="S级垫抽"
            value={banner.sPity}
            max={hard - 1}
            suffix={`/ ${hard - 1}`}
            onChange={(sPity) => updateBanner(kind, { sPity })}
          />
          <NumberInput
            label="A级垫抽"
            value={banner.aPity}
            max={9}
            suffix="/ 9"
            onChange={(aPity) => updateBanner(kind, { aPity })}
          />
        </div>
        <Toggle
          label="下一个S级为大保底"
          checked={banner.guaranteedS}
          onChange={(guaranteedS) => updateBanner(kind, { guaranteedS })}
        />
        <Toggle
          label="下一个A级为当期UP"
          checked={banner.guaranteedA}
          onChange={(guaranteedA) => updateBanner(kind, { guaranteedA })}
        />
      </div>
    );
  };

  const shortage = (needed: number) => Math.max(0, Math.ceil(needed) - currentResourcePulls);

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="返回页面顶部">
          <span>NE</span>
          <strong>新艾利都资源规划局</strong>
        </a>
        <div className="version-chip">规则 {RULE_VERSION}</div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">SIGNAL ACQUISITION FORECAST</p>
          <h1>把运气，换算成<br /><em>可以准备的资源。</em></h1>
          <p className="hero-lead">输入现有菲林、保底状态与有序目标，估算全部达成概率，以及平均、80%、90%、95%和最坏保底所需资源。</p>
          <div className="hero-actions">
            <a className="primary-button" href="#planner">开始规划 <span>↘</span></a>
            <a className="text-link" href="#rules">查看模型说明</a>
          </div>
        </div>
        <div className="hero-meter" aria-label="当前可用抽数">
          <div className="meter-grid" />
          <span>AVAILABLE SIGNALS</span>
          <strong>{currentResourcePulls}</strong>
          <small>当前可用抽数</small>
          <div className="meter-line"><i style={{ width: `${Math.min(100, (currentResourcePulls / 180) * 100)}%` }} /></div>
          <p>{currentResourcePulls >= 180 ? "已覆盖单代理人最坏保底" : `距离单代理人最坏保底还差 ${180 - currentResourcePulls} 抽`}</p>
        </div>
      </section>

      <div className="notice-strip"><span>非官方概率规划工具</span><p>软保底曲线与返还分布为近似模拟，结果不是实际抽取承诺。</p></div>

      <section className="workspace" id="planner">
        <div className="section-heading">
          <p>01 / INPUT</p>
          <h2>现有资源</h2>
          <span>资源会合并为可用于限定代理人与音擎的抽数。</span>
        </div>
        <div className="resource-grid panel">
          <NumberInput label="菲林" value={state.resources.polychrome} suffix="枚" onChange={(polychrome) => setState((current) => ({ ...current, resources: { ...current.resources, polychrome } }))} />
          <NumberInput label="单色菲林" value={state.resources.monochrome} suffix="枚" onChange={(monochrome) => setState((current) => ({ ...current, resources: { ...current.resources, monochrome } }))} />
          <NumberInput label="加密母带" value={state.resources.encryptedTapes} suffix="张" onChange={(encryptedTapes) => setState((current) => ({ ...current, resources: { ...current.resources, encryptedTapes } }))} />
          <NumberInput label="信号余波" value={state.resources.residualSignals} suffix="个" onChange={(residualSignals) => setState((current) => ({ ...current, resources: { ...current.resources, residualSignals } }))} />
          <div className="resource-total">
            <span>可用资源合计</span>
            <strong>{currentResourcePulls}<small>抽</small></strong>
            <p>余下 {(state.resources.polychrome + state.resources.monochrome) % 160} 菲林 · {state.resources.residualSignals % 20} 余波</p>
          </div>
        </div>

        <div className="section-heading">
          <p>02 / PITY</p>
          <h2>保底状态</h2>
          <span>同类限定频段继承，代理人与音擎分别计算。</span>
        </div>
        <div className="banner-grid">
          {renderBanner("agent", "限定代理人频段")}
          {renderBanner("engine", "限定音擎频段")}
        </div>

        <div className="section-heading">
          <p>03 / PROFILE</p>
          <h2>账号画像</h2>
          <span>只需填写每个持有档位有多少名常驻代理人，用于估算重复返还。</span>
        </div>
        <div className="profile-grid">
          {(["standardSBuckets", "standardABuckets"] as const).map((key) => (
            <div className="panel bucket-card" key={key}>
              <div className="profile-title">
                <h3>{key === "standardSBuckets" ? "常驻S级代理人" : "其他A级代理人"}</h3>
                <span>合计 {state.ownership[key].reduce((sum, value) => sum + value, 0)} 名</span>
              </div>
              <div className="bucket-grid">
                {BUCKET_LABELS.map((label, index) => (
                  <NumberInput
                    key={label}
                    label={label}
                    value={state.ownership[key][index] ?? 0}
                    max={99}
                    onChange={(value) => setState((current) => {
                      const buckets = [...current.ownership[key]];
                      buckets[index] = value;
                      return { ...current, ownership: { ...current.ownership, [key]: buckets } };
                    })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="section-heading goals-heading">
          <div><p>04 / TARGETS</p><h2>目标清单</h2><span>按顺序抽取；拖动卡片或使用箭头调整优先级。</span></div>
          <div className="add-actions">
            <button onClick={() => setState((current) => ({ ...current, goals: [...current.goals, createGoal("agent")] }))}>＋ 代理人</button>
            <button onClick={() => setState((current) => ({ ...current, goals: [...current.goals, createGoal("engine")] }))}>＋ 音擎</button>
          </div>
        </div>
        <div className="goal-list">
          {state.goals.map((goal, index) => {
            const maxOwned = goal.kind === "agent" ? 7 : 5;
            return (
              <article
                className={`goal-card ${draggedId === goal.id ? "dragging" : ""}`}
                key={goal.id}
                draggable
                onDragStart={() => setDraggedId(goal.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropGoal(goal.id)}
              >
                <div className="goal-order"><span>{String(index + 1).padStart(2, "0")}</span><i>⠿</i></div>
                <div className="goal-main">
                  <div className="goal-topline">
                    <label className="kind-select">
                      <span>频段</span>
                      <select value={goal.kind} onChange={(event) => {
                        const kind = event.target.value as GoalKind;
                        updateGoal(goal.id, { kind, currentOwned: 0, targetOwned: 1, featuredA: kind === "agent" ? ["UP A级代理人 1", "UP A级代理人 2"] : ["UP A级音擎 1", "UP A级音擎 2"] });
                      }}>
                        <option value="agent">限定代理人</option>
                        <option value="engine">限定音擎</option>
                      </select>
                    </label>
                    <label className="name-field"><span>目标名称</span><input value={goal.name} maxLength={30} onChange={(event) => updateGoal(goal.id, { name: event.target.value })} /></label>
                    <div className="goal-controls">
                      <button aria-label="上移" disabled={index === 0} onClick={() => moveGoal(goal.id, -1)}>↑</button>
                      <button aria-label="下移" disabled={index === state.goals.length - 1} onClick={() => moveGoal(goal.id, 1)}>↓</button>
                      <button className="danger" aria-label="删除目标" onClick={() => setState((current) => ({ ...current, goals: current.goals.filter((item) => item.id !== goal.id) }))}>×</button>
                    </div>
                  </div>
                  <div className="goal-fields">
                    <NumberInput label="当前持有" value={goal.currentOwned} max={maxOwned} suffix={goal.kind === "agent" ? "份" : "星"} onChange={(currentOwned) => updateGoal(goal.id, { currentOwned, targetOwned: Math.max(currentOwned, goal.targetOwned) })} />
                    <NumberInput label="目标持有" value={goal.targetOwned} min={1} max={maxOwned} suffix={goal.kind === "agent" ? "份" : "星"} onChange={(targetOwned) => updateGoal(goal.id, { targetOwned: Math.max(goal.currentOwned, targetOwned) })} />
                    <Toggle label="重映首次S级必得" checked={goal.specialGuarantee} hint="仅消耗该目标的特殊保底" onChange={(specialGuarantee) => updateGoal(goal.id, { specialGuarantee })} />
                  </div>
                  <div className="featured-a-row">
                    <span>本期UP A级</span>
                    {goal.featuredA.map((name, aIndex) => (
                      <input key={aIndex} value={name} onChange={(event) => {
                        const next = [...goal.featuredA] as [string, string];
                        next[aIndex] = event.target.value;
                        updateGoal(goal.id, { featuredA: next });
                        if (goal.kind === "agent" && !(event.target.value in state.ownership.trackedAAgents)) {
                          setState((current) => ({ ...current, ownership: { ...current.ownership, trackedAAgents: { ...current.ownership.trackedAAgents, [event.target.value]: 0 } } }));
                        }
                      }} />
                    ))}
                  </div>
                  {goal.kind === "agent" && (
                    <div className="tracked-row">
                      {goal.featuredA.map((name) => (
                        <NumberInput key={name} label={`${name || "未命名UP"} 当前`} value={state.ownership.trackedAAgents[name] ?? 0} max={7} suffix="份" onChange={(value) => setState((current) => ({ ...current, ownership: { ...current.ownership, trackedAAgents: { ...current.ownership.trackedAAgents, [name]: value } } }))} />
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
          {!state.goals.length && <div className="empty-state">目标清单还是空的。添加代理人或音擎后即可计算。</div>}
        </div>

        <section className="results-section" aria-live="polite">
          <div className="results-header">
            <div><p>05 / FORECAST</p><h2>规划结果</h2><span>{status}</span></div>
            <div className="run-actions">
              {isRunning ? <button className="secondary-button" onClick={stopWorker}>停止计算</button> : <button className="primary-button" onClick={() => run(100_000, "精确模拟")}>运行 10 万次精确模拟</button>}
            </div>
          </div>
          {result ? (
            <>
              <div className="result-hero">
                <div className="probability-block"><span>全部目标达成概率</span><strong>{pct(result.totalProbability)}</strong><p>当前 {result.availablePulls} 抽 · 计入余波返还</p></div>
                <div className="probability-compare"><span>不计返还</span><strong>{pct(result.totalProbabilityWithoutCashback)}</strong><p>平均返还 {result.generatedRefundPullsMean.toFixed(1)} 抽</p></div>
                <div className="confidence-note"><i>±</i><div><strong>{(result.standardError * 100).toFixed(2)} 个百分点</strong><span>抽样标准误差 · {result.iterations.toLocaleString("zh-CN")} 次模拟</span></div></div>
              </div>
              <div className="result-grid">
                {[{ key: "mean", label: "平均所需" }, { key: "p80", label: "80% 把握" }, { key: "p90", label: "90% 把握" }, { key: "p95", label: "95% 把握" }] .map((item) => {
                  const needed = result.withCashback[item.key as keyof typeof result.withCashback];
                  const gap = shortage(needed);
                  return <div className="metric-card" key={item.key}><span>{item.label}</span><strong>{pullLabel(needed)}</strong><p className={gap ? "short" : "enough"}>{gap ? `还差 ${gap} 抽 / ${(gap * POLYCHROME_PER_PULL).toLocaleString("zh-CN")} 菲林` : "现有资源已覆盖"}</p></div>;
                })}
                <div className="metric-card hard"><span>最坏硬保底</span><strong>{pullLabel(result.hardPityPulls)}</strong><p className={shortage(result.hardPityPulls) ? "short" : "enough"}>{shortage(result.hardPityPulls) ? `还差 ${shortage(result.hardPityPulls)} 抽 / ${(shortage(result.hardPityPulls) * 160).toLocaleString("zh-CN")} 菲林` : "现有资源已覆盖"}</p></div>
              </div>
              <div className="goal-probabilities panel">
                <div className="profile-title"><h3>按顺序累计达成</h3><span>后一个目标包含之前目标已完成</span></div>
                {result.goalProbabilities.map((goal, index) => (
                  <div className="probability-row" key={goal.id}><span><i>{index + 1}</i>{goal.name || "未命名目标"}</span><div><b style={{ width: `${goal.probability * 100}%` }} /></div><strong>{pct(goal.probability)}</strong></div>
                ))}
              </div>
              <div className="cashback-table panel">
                <div className="profile-title"><h3>返还资源影响</h3><span>同一批随机路径对照</span></div>
                <div className="table-scroll"><table><thead><tr><th>口径</th><th>平均</th><th>80%</th><th>90%</th><th>95%</th></tr></thead><tbody><tr><td>计入余波返还</td><td>{pullLabel(result.withCashback.mean)}</td><td>{pullLabel(result.withCashback.p80)}</td><td>{pullLabel(result.withCashback.p90)}</td><td>{pullLabel(result.withCashback.p95)}</td></tr><tr><td>不计返还</td><td>{pullLabel(result.withoutCashback.mean)}</td><td>{pullLabel(result.withoutCashback.p80)}</td><td>{pullLabel(result.withoutCashback.p90)}</td><td>{pullLabel(result.withoutCashback.p95)}</td></tr></tbody></table></div>
              </div>
            </>
          ) : <div className="results-loading"><span /><p>{status}</p></div>}
        </section>

        <section className="data-actions panel">
          <div><h3>本机数据</h3><p>自动保存在当前浏览器；可导出备份，不上传账号信息。</p>{importError && <strong className="error-text">{importError}</strong>}</div>
          <div><button onClick={exportData}>导出 JSON</button><label className="file-button">导入 JSON<input type="file" accept="application/json" onChange={(event) => importData(event.target.files?.[0])} /></label><button className="danger-text" onClick={reset}>清空</button></div>
        </section>

        <section className="rules-section" id="rules">
          <div className="section-heading"><p>06 / MODEL</p><h2>规则与模型</h2><span>官方确认规则与非官方近似分开标注。</span></div>
          <div className="rules-grid">
            <article><span className="source-tag official">官方规则</span><h3>限定代理人</h3><p>S级基础概率0.6%，90抽硬保底；普通限定S级为50/50，失败后下一个S级必为目标。</p><a href="https://zzz.mihoyo.com/news/155319" target="_blank" rel="noreferrer">查看限定频段说明 ↗</a></article>
            <article><span className="source-tag official">官方规则</span><h3>音擎与重映</h3><p>限定音擎80抽硬保底、75/25；特定重映频段首次S级可直接命中所选目标。</p><a href="https://zzz.mihoyo.com/news/162218" target="_blank" rel="noreferrer">查看重映规则 ↗</a></article>
            <article><span className="source-tag estimate">近似模型</span><h3>软保底曲线</h3><p>代理人第74抽起每抽增加6个百分点；音擎第65抽起每抽增加7个百分点。官方未公开逐抽递增曲线。</p></article>
            <article><span className="source-tag estimate">模拟假设</span><h3>返还与优先级</h3><p>S级优先于A级判定，并视为满足“A级或以上”保底；非UP A级按代理人与音擎各半处理。</p></article>
          </div>
          <div className="disclaimer"><strong>理性消费提示</strong><p>概率不是承诺，平均值也不是保底。请根据可承受范围规划，不要借贷或超出预算进行抽取。本工具与米哈游、HoYoverse无关联。</p></div>
        </section>
      </section>

      <footer><span>NEW ERIDU SIGNAL PLANNER</span><p>数据只保存在你的设备 · 规则版本 {RULE_VERSION}</p></footer>
    </main>
  );
}
