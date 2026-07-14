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
    <div className="app-shell" id="top">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="返回页面顶部">
          <span>NE</span>
          <strong>新艾利都资源规划局</strong>
        </a>
        <nav className="top-links" aria-label="页面导航">
          <a href="#planner">参数</a>
          <a href="#results">结果</a>
          <a href="#rules">规则</a>
        </nav>
        <div className="version-chip">规则 {RULE_VERSION}</div>
      </header>

      <main className="workspace" id="planner">
        <aside className="config-sidebar">
          <div className="sidebar-card">
            <div className="sidebar-heading">
              <div>
                <p>PARAMETERS</p>
                <h2>参数配置</h2>
              </div>
              <span>输入资源，看目标达成率</span>
            </div>

            <section className="config-block">
              <div className="block-heading">
                <h3>现有资源</h3>
                <strong>{currentResourcePulls} 抽</strong>
              </div>
              <div className="resource-grid">
                <NumberInput label="菲林" value={state.resources.polychrome} suffix="枚" onChange={(polychrome) => setState((current) => ({ ...current, resources: { ...current.resources, polychrome } }))} />
                <NumberInput label="单色菲林" value={state.resources.monochrome} suffix="枚" onChange={(monochrome) => setState((current) => ({ ...current, resources: { ...current.resources, monochrome } }))} />
                <NumberInput label="加密母带" value={state.resources.encryptedTapes} suffix="张" onChange={(encryptedTapes) => setState((current) => ({ ...current, resources: { ...current.resources, encryptedTapes } }))} />
                <NumberInput label="信号余波" value={state.resources.residualSignals} suffix="个" onChange={(residualSignals) => setState((current) => ({ ...current, resources: { ...current.resources, residualSignals } }))} />
              </div>
              <p className="resource-note">160 菲林 = 1 抽 · 20 余波 = 1 张母带</p>
            </section>

            <section className="config-block">
              <div className="block-heading">
                <h3>保底状态</h3>
                <span>两个池独立继承</span>
              </div>
              <div className="banner-grid">
                {renderBanner("agent", "限定代理人")}
                {renderBanner("engine", "限定音擎")}
              </div>
            </section>

            <section className="config-block goals-block">
              <div className="block-heading targets-heading">
                <div><h3>目标清单</h3><span>按顺序消耗资源</span></div>
                <div className="add-actions">
                  <button onClick={() => setState((current) => ({ ...current, goals: [...current.goals, createGoal("agent")] }))}>＋代理人</button>
                  <button onClick={() => setState((current) => ({ ...current, goals: [...current.goals, createGoal("engine")] }))}>＋音擎</button>
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
                      <div className="goal-card-head">
                        <span className={`goal-order ${goal.kind}`}>{index + 1}</span>
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
                        <div className="goal-controls">
                          <button aria-label="上移" disabled={index === 0} onClick={() => moveGoal(goal.id, -1)}>↑</button>
                          <button aria-label="下移" disabled={index === state.goals.length - 1} onClick={() => moveGoal(goal.id, 1)}>↓</button>
                          <button className="danger" aria-label="删除目标" onClick={() => setState((current) => ({ ...current, goals: current.goals.filter((item) => item.id !== goal.id) }))}>×</button>
                        </div>
                      </div>
                      <label className="name-field"><span>目标名称</span><input value={goal.name} maxLength={30} onChange={(event) => updateGoal(goal.id, { name: event.target.value })} /></label>
                      <div className="goal-fields">
                        <NumberInput label="当前持有" value={goal.currentOwned} max={maxOwned} suffix={goal.kind === "agent" ? "份" : "星"} onChange={(currentOwned) => updateGoal(goal.id, { currentOwned, targetOwned: Math.max(currentOwned, goal.targetOwned) })} />
                        <NumberInput label="目标持有" value={goal.targetOwned} min={1} max={maxOwned} suffix={goal.kind === "agent" ? "份" : "星"} onChange={(targetOwned) => updateGoal(goal.id, { targetOwned: Math.max(goal.currentOwned, targetOwned) })} />
                      </div>
                      <Toggle label="重映首次S级必得" checked={goal.specialGuarantee} hint="仅消耗该目标的特殊保底" onChange={(specialGuarantee) => updateGoal(goal.id, { specialGuarantee })} />
                      <details className="goal-advanced">
                        <summary>UP A级与返还设置</summary>
                        <div className="featured-a-row">
                          {goal.featuredA.map((name, aIndex) => (
                            <label key={aIndex}><span>UP A级 {aIndex + 1}</span><input value={name} onChange={(event) => {
                              const next = [...goal.featuredA] as [string, string];
                              next[aIndex] = event.target.value;
                              updateGoal(goal.id, { featuredA: next });
                              if (goal.kind === "agent" && !(event.target.value in state.ownership.trackedAAgents)) {
                                setState((current) => ({ ...current, ownership: { ...current.ownership, trackedAAgents: { ...current.ownership.trackedAAgents, [event.target.value]: 0 } } }));
                              }
                            }} /></label>
                          ))}
                        </div>
                        {goal.kind === "agent" && (
                          <div className="tracked-row">
                            {goal.featuredA.map((name) => (
                              <NumberInput key={name} label={`${name || "未命名UP"} 当前`} value={state.ownership.trackedAAgents[name] ?? 0} max={7} suffix="份" onChange={(value) => setState((current) => ({ ...current, ownership: { ...current.ownership, trackedAAgents: { ...current.ownership.trackedAAgents, [name]: value } } }))} />
                            ))}
                          </div>
                        )}
                      </details>
                    </article>
                  );
                })}
                {!state.goals.length && <div className="empty-state">添加一个代理人或音擎目标后即可计算。</div>}
              </div>
            </section>

            <details className="config-block profile-section">
              <summary><span><strong>高级：账号返还画像</strong><small>用于估算重复代理人产生的余波</small></span></summary>
              <div className="profile-grid">
                {(["standardSBuckets", "standardABuckets"] as const).map((key) => (
                  <div className="bucket-card" key={key}>
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
            </details>

            <section className="data-actions">
              <div><strong>本机数据</strong><span>自动保存，不上传账号信息</span></div>
              {importError && <p className="error-text">{importError}</p>}
              <div className="data-buttons">
                <button onClick={exportData}>导出</button>
                <label className="file-button">导入<input type="file" accept="application/json" onChange={(event) => importData(event.target.files?.[0])} /></label>
                <button className="danger-text" onClick={reset}>重置</button>
              </div>
            </section>

            <div className="run-panel">
              <span>{status}</span>
              {isRunning
                ? <button className="secondary-button" onClick={stopWorker}>停止计算</button>
                : <button className="primary-button" onClick={() => run(100_000, "精确模拟")}>运行 10 万次精确模拟</button>}
            </div>
          </div>
        </aside>

        <section className="content" id="results">
          <header className="content-heading">
            <div>
              <p>NEW ERIDU SIGNAL PLANNER</p>
              <h1>抽卡目标规划</h1>
              <span>输入现有资源与目标，估算达成概率和补抽需求。</span>
            </div>
            <div className="available-chip"><span>当前资源</span><strong>{currentResourcePulls}</strong><small>抽</small></div>
          </header>

          <div className="notice-strip"><strong>非官方工具</strong><span>软保底曲线与返还分布为近似模拟，概率不是抽取承诺。</span></div>

          <section className="results-section" aria-live="polite">
            <div className="results-header">
              <div><p>RESULTS</p><h2>结果概览</h2></div>
              <span>{status}</span>
            </div>
            {result ? (
              <>
                <div className="result-hero">
                  <article className="probability-block"><span>全部目标达成率</span><strong>{pct(result.totalProbability)}</strong><p>当前资源 · 计入余波返还</p></article>
                  <article className="summary-stat"><span>90% 把握所需</span><strong>{pullLabel(result.withCashback.p90)}</strong><p>{shortage(result.withCashback.p90) ? `还差 ${shortage(result.withCashback.p90)} 抽` : "现有资源已覆盖"}</p></article>
                  <article className="summary-stat"><span>平均返还影响</span><strong>{result.generatedRefundPullsMean.toFixed(1)} 抽</strong><p>不计返还达成率 {pct(result.totalProbabilityWithoutCashback)}</p></article>
                </div>
                <p className="confidence-note">抽样标准误差 ±{(result.standardError * 100).toFixed(2)} 个百分点 · {result.iterations.toLocaleString("zh-CN")} 次固定种子模拟</p>
                <div className="result-grid">
                  {[{ key: "mean", label: "平均所需" }, { key: "p80", label: "80% 把握" }, { key: "p90", label: "90% 把握" }, { key: "p95", label: "95% 把握" }] .map((item) => {
                    const needed = result.withCashback[item.key as keyof typeof result.withCashback];
                    const gap = shortage(needed);
                    return <article className="metric-card" key={item.key}><span>{item.label}</span><strong>{pullLabel(needed)}</strong><p className={gap ? "short" : "enough"}>{gap ? `还差 ${gap} 抽 / ${(gap * POLYCHROME_PER_PULL).toLocaleString("zh-CN")} 菲林` : "现有资源已覆盖"}</p></article>;
                  })}
                  <article className="metric-card hard"><span>最坏硬保底</span><strong>{pullLabel(result.hardPityPulls)}</strong><p className={shortage(result.hardPityPulls) ? "short" : "enough"}>{shortage(result.hardPityPulls) ? `还差 ${shortage(result.hardPityPulls)} 抽 / ${(shortage(result.hardPityPulls) * 160).toLocaleString("zh-CN")} 菲林` : "现有资源已覆盖"}</p></article>
                </div>
                <div className="goal-probabilities panel">
                  <div className="profile-title"><h3>逐目标累计达成率</h3><span>后一个目标包含之前目标已完成</span></div>
                  {result.goalProbabilities.map((goal, index) => (
                    <div className="probability-row" key={goal.id}><span><i>{index + 1}</i>{goal.name || "未命名目标"}</span><div><b style={{ width: `${goal.probability * 100}%` }} /></div><strong>{pct(goal.probability)}</strong></div>
                  ))}
                </div>
                <div className="cashback-table panel">
                  <div className="profile-title"><h3>返还资源对照</h3><span>同一批随机路径</span></div>
                  <div className="table-scroll"><table><thead><tr><th>口径</th><th>平均</th><th>80%</th><th>90%</th><th>95%</th></tr></thead><tbody><tr><td>计入余波返还</td><td>{pullLabel(result.withCashback.mean)}</td><td>{pullLabel(result.withCashback.p80)}</td><td>{pullLabel(result.withCashback.p90)}</td><td>{pullLabel(result.withCashback.p95)}</td></tr><tr><td>不计返还</td><td>{pullLabel(result.withoutCashback.mean)}</td><td>{pullLabel(result.withoutCashback.p80)}</td><td>{pullLabel(result.withoutCashback.p90)}</td><td>{pullLabel(result.withoutCashback.p95)}</td></tr></tbody></table></div>
                </div>
              </>
            ) : <div className="results-loading"><span /><p>{status}</p></div>}
          </section>

          <details className="rules-section" id="rules">
            <summary><span><strong>规则与模型说明</strong><small>官方规则、软保底近似与模拟边界</small></span></summary>
            <div className="rules-grid">
              <article><span className="source-tag official">官方规则</span><h3>限定代理人</h3><p>S级基础概率0.6%，90抽硬保底；普通限定S级为50/50，失败后下一个S级必为目标。</p><a href="https://zzz.mihoyo.com/news/155319" target="_blank" rel="noreferrer">查看限定频段说明 ↗</a></article>
              <article><span className="source-tag official">官方规则</span><h3>音擎与重映</h3><p>限定音擎80抽硬保底、75/25；特定重映频段首次S级可直接命中所选目标。</p><a href="https://zzz.mihoyo.com/news/162218" target="_blank" rel="noreferrer">查看重映规则 ↗</a></article>
              <article><span className="source-tag estimate">近似模型</span><h3>软保底曲线</h3><p>代理人第74抽起每抽增加6个百分点；音擎第65抽起每抽增加7个百分点。官方未公开逐抽递增曲线。</p></article>
              <article><span className="source-tag estimate">模拟假设</span><h3>返还与优先级</h3><p>S级优先于A级判定，并视为满足“A级或以上”保底；非UP A级按代理人与音擎各半处理。</p></article>
            </div>
          </details>

          <div className="disclaimer"><strong>理性消费提示</strong><p>概率不是承诺，平均值也不是保底。请根据可承受范围规划，不要借贷或超出预算进行抽取。本工具与米哈游、HoYoverse无关联。</p></div>
          <footer><span>NEW ERIDU SIGNAL PLANNER</span><p>数据只保存在你的设备 · 规则版本 {RULE_VERSION}</p></footer>
        </section>
      </main>
    </div>
  );
}
