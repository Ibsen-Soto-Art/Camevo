import { useMemo, useState, type FormEvent } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./App.css";
import { connectToRunStream, createRun, type GenerationSnapshot, type LiveMessage, type RunFormValues } from "./lib/camevo-client";

type RunStatus = "idle" | "running" | "done" | "error";

const DEFAULT_FORM: RunFormValues = {
  gridWidth: 20,
  gridHeight: 20,
  mutationRate: 0.05,
  updates: 400,
  placementMode: "near-parent",
  reproducibilityMode: "reproducible",
  climateEnabled: true,
};

/** Aplana los snapshots a filas {generation, averageFitness, [taskId]: multiplier} para Recharts (RF-020 + RF-022). */
function toChartRows(snapshots: readonly GenerationSnapshot[]): Record<string, number>[] {
  return snapshots.map((snapshot) => {
    const row: Record<string, number> = {
      generation: snapshot.generation,
      averageFitness: snapshot.averageFitness,
    };
    for (const resource of snapshot.climate) {
      row[resource.taskId] = resource.rewardMultiplier;
    }
    return row;
  });
}

export default function App() {
  const [form, setForm] = useState<RunFormValues>(DEFAULT_FORM);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<GenerationSnapshot[]>([]);

  const climateTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const snapshot of snapshots) {
      for (const resource of snapshot.climate) ids.add(resource.taskId);
    }
    return [...ids];
  }, [snapshots]);

  const chartRows = useMemo(() => toChartRows(snapshots), [snapshots]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("running");
    setErrorMessage(null);
    setSnapshots([]);

    try {
      const { runId: newRunId } = await createRun(form);
      setRunId(newRunId);

      connectToRunStream(newRunId, (message: LiveMessage) => {
        if (message.type === "snapshot") {
          setSnapshots((prev) => [...prev, message.snapshot]);
        } else if (message.type === "done") {
          setStatus("done");
        } else if (message.type === "error") {
          setStatus("error");
          setErrorMessage(message.message);
        }
      });
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Error desconocido");
    }
  }

  return (
    <main className="camevo-app">
      <h1>Camevo — Fase 2</h1>
      <p className="subtitle">Fitness promedio de la población frente a la curva climática, generación a generación.</p>

      <form className="run-form" onSubmit={handleSubmit}>
        <label>
          Ancho de grilla
          <input
            type="number"
            min={2}
            max={40}
            value={form.gridWidth}
            onChange={(e) => setForm({ ...form, gridWidth: Number(e.target.value) })}
          />
        </label>
        <label>
          Alto de grilla
          <input
            type="number"
            min={2}
            max={40}
            value={form.gridHeight}
            onChange={(e) => setForm({ ...form, gridHeight: Number(e.target.value) })}
          />
        </label>
        <label>
          Tasa de mutación
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={form.mutationRate}
            onChange={(e) => setForm({ ...form, mutationRate: Number(e.target.value) })}
          />
        </label>
        <label>
          Generaciones
          <input
            type="number"
            min={1}
            max={5000}
            value={form.updates}
            onChange={(e) => setForm({ ...form, updates: Number(e.target.value) })}
          />
        </label>
        <label>
          Colocación de la cría
          <select
            value={form.placementMode}
            onChange={(e) => setForm({ ...form, placementMode: e.target.value as RunFormValues["placementMode"] })}
          >
            <option value="near-parent">Cerca del padre</option>
            <option value="random">Aleatoria</option>
          </select>
        </label>
        <label>
          Repetibilidad
          <select
            value={form.reproducibilityMode}
            onChange={(e) =>
              setForm({ ...form, reproducibilityMode: e.target.value as RunFormValues["reproducibilityMode"] })
            }
          >
            <option value="reproducible">Reproducible</option>
            <option value="experimental">Experimental</option>
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.climateEnabled}
            onChange={(e) => setForm({ ...form, climateEnabled: e.target.checked })}
          />
          Módulo climático activo
        </label>

        <button type="submit" disabled={status === "running"}>
          {status === "running" ? "Corriendo…" : "Iniciar corrida"}
        </button>
      </form>

      {runId && (
        <p className="status-line">
          Corrida <code>{runId}</code> — estado: <strong>{status}</strong>
        </p>
      )}
      {errorMessage && <p className="error">{errorMessage}</p>}

      <div className="chart-container">
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={chartRows} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="generation" label={{ value: "Generación", position: "insideBottom", offset: -5 }} />
            <YAxis yAxisId="fitness" domain={[0, "auto"]} label={{ value: "Fitness", angle: -90, position: "insideLeft" }} />
            <YAxis
              yAxisId="climate"
              orientation="right"
              domain={[0, "auto"]}
              label={{ value: "Multiplicador climático", angle: 90, position: "insideRight" }}
            />
            <Tooltip />
            <Legend />
            <Line
              yAxisId="fitness"
              type="monotone"
              dataKey="averageFitness"
              name="Fitness promedio"
              stroke="#1f77b4"
              dot={false}
              isAnimationActive={false}
            />
            {climateTaskIds.map((taskId, index) => (
              <Line
                key={taskId}
                yAxisId="climate"
                type="monotone"
                dataKey={taskId}
                name={`Clima: ${taskId}`}
                stroke={["#d62728", "#2ca02c", "#9467bd"][index % 3]}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </main>
  );
}
