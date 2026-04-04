/**
 * @fileoverview util/metrics.
 *
 * In-memory metrics registry with optional durable snapshot + Pushgateway export helpers.
 */
import { getRuntimeConfig } from "../config/runtime.config";

type LabelValues = Record<string, string | number | boolean | null | undefined>;

type CounterSample = {
    labels: Record<string, string>;
    value: number;
};

type HistogramSample = {
  labels: Record<string, string>;
  sum: number;
  count: number;
  buckets: Record<string, number>;
};
type HistogramRegistry = {
  bucketBounds: number[];
  samples: Map<string, HistogramSample>;
};

type MetricsSnapshot = {
  version: 1;
  counters: Array<{ name: string; labels: Record<string, string>; value: number }>;
  histograms: Array<{
    name: string;
    bucketBounds: number[];
    samples: Array<{ labels: Record<string, string>; sum: number; count: number; buckets: Record<string, number> }>;
  }>;
};

const counters = new Map<string, Map<string, CounterSample>>();
const histograms = new Map<string, HistogramRegistry>();
let exporterTimer: NodeJS.Timeout | null = null;
let exporterStarted = false;
let exporterInFlight = false;
let snapshotLoaded = false;
let snapshotPersistTimer: NodeJS.Timeout | null = null;
let snapshotPersistInFlight = false;

type MetricsExporterConfig = {
  enabled: boolean;
  pushgatewayUrl: string;
  job: string;
  instance: string;
  intervalMs: number;
  timeoutMs: number;
  snapshotPath: string;
};

/**
 * Resolves exporter settings from validated runtime configuration.
 */
function getExporterConfig(): MetricsExporterConfig {
  const runtime = getRuntimeConfig();
  const pushgatewayUrl = String(runtime.metricsExporter.pushgatewayUrl || "").trim().replace(/\/$/, "");
  const configDir = runtime.configPath.includes("/")
    ? runtime.configPath.slice(0, runtime.configPath.lastIndexOf("/"))
    : ".";
  const snapshotPath = String(runtime.metricsExporter.snapshotPath || "").trim()
    || `${configDir}/metrics.snapshot.json`;
  return {
    enabled: Boolean(pushgatewayUrl),
    pushgatewayUrl,
    job: String(runtime.metricsExporter.jobName || "autopilot-backend").trim() || "autopilot-backend",
    instance: String(runtime.metricsExporter.instanceId || process.env.HOSTNAME || process.pid).trim() || String(process.pid),
    intervalMs: Math.max(5_000, runtime.metricsExporter.pushIntervalMs),
    timeoutMs: Math.max(1_000, runtime.metricsExporter.pushTimeoutMs),
    snapshotPath,
  };
}

/**
 * Builds the Pushgateway endpoint for the configured job/instance pair.
 */
function metricsPushUrl(cfg: MetricsExporterConfig): string {
  const job = encodeURIComponent(cfg.job);
  const instance = encodeURIComponent(cfg.instance);
  return `${cfg.pushgatewayUrl}/metrics/job/${job}/instance/${instance}`;
}

function buildSnapshot(): MetricsSnapshot {
  return {
    version: 1,
    counters: Array.from(counters.entries()).flatMap(([name, byLabels]) =>
      Array.from(byLabels.values()).map((sample) => ({
        name,
        labels: sample.labels,
        value: sample.value,
      })),
    ),
    histograms: Array.from(histograms.entries()).map(([name, histogram]) => ({
      name,
      bucketBounds: histogram.bucketBounds,
      samples: Array.from(histogram.samples.values()).map((sample) => ({
        labels: sample.labels,
        sum: sample.sum,
        count: sample.count,
        buckets: sample.buckets,
      })),
    })),
  };
}

async function persistSnapshotNow(): Promise<void> {
  if (snapshotPersistInFlight) return;
  snapshotPersistInFlight = true;
  try {
    const cfg = getExporterConfig();
    const bunRuntime = (globalThis as { Bun?: { write: (target: string, data: string) => Promise<number> } }).Bun;
    if (!bunRuntime) return;
    await bunRuntime.write(cfg.snapshotPath, JSON.stringify(buildSnapshot()));
  } catch {
    // Best-effort persistence, never fail request paths.
  } finally {
    snapshotPersistInFlight = false;
  }
}

function scheduleSnapshotPersist(): void {
  if (snapshotPersistTimer) return;
  snapshotPersistTimer = setTimeout(() => {
    snapshotPersistTimer = null;
    void persistSnapshotNow();
  }, 2_000);
  snapshotPersistTimer.unref?.();
}

async function loadSnapshotOnce(): Promise<void> {
  if (snapshotLoaded) return;
  snapshotLoaded = true;
  try {
    const cfg = getExporterConfig();
    const bunRuntime = (globalThis as { Bun?: { file: (path: string) => { text: () => Promise<string>; exists: () => Promise<boolean> } } }).Bun;
    if (!bunRuntime) return;
    const file = bunRuntime.file(cfg.snapshotPath);
    if (!(await file.exists())) return;
    const raw = await file.text();
    const parsed = JSON.parse(raw) as MetricsSnapshot;
    if (!parsed || parsed.version !== 1) return;

    for (const row of parsed.counters || []) {
      if (!row?.name || typeof row.value !== "number") continue;
      const labels = normalizeLabels(row.labels);
      const key = labelsKey(labels);
      const byLabels = counters.get(row.name) || new Map<string, CounterSample>();
      byLabels.set(key, { labels, value: row.value });
      counters.set(row.name, byLabels);
    }

    for (const item of parsed.histograms || []) {
      if (!item?.name || !Array.isArray(item.bucketBounds)) continue;
      const registry: HistogramRegistry = {
        bucketBounds: item.bucketBounds.filter((v) => Number.isFinite(v)),
        samples: new Map<string, HistogramSample>(),
      };
      for (const sample of item.samples || []) {
        if (!sample || typeof sample.sum !== "number" || typeof sample.count !== "number") continue;
        const labels = normalizeLabels(sample.labels);
        const key = labelsKey(labels);
        registry.samples.set(key, {
          labels,
          sum: sample.sum,
          count: sample.count,
          buckets: Object.fromEntries(
            Object.entries(sample.buckets || {}).filter(([, value]) => Number.isFinite(Number(value))),
          ),
        });
      }
      histograms.set(item.name, registry);
    }
  } catch {
    // No snapshot yet / corrupted file should not block startup.
  }
}

function ensureMetricsStateLoaded(): void {
  if (snapshotLoaded) return;
  // Fire-and-forget: first few requests may miss restored counters, acceptable.
  void loadSnapshotOnce();
}

/**
 * Sends a best-effort metrics snapshot to Pushgateway.
 */
async function pushMetricsSnapshot(): Promise<void> {
  const cfg = getExporterConfig();
  if (!cfg.enabled || exporterInFlight) return;
  exporterInFlight = true;
  try {
    await fetch(metricsPushUrl(cfg), {
      method: "PUT",
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      },
      body: renderPrometheusMetrics(),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch {
    // Best-effort exporter: do not throw into request path.
  } finally {
    exporterInFlight = false;
  }
}

/**
 * Lazily starts the background exporter timer on first metric write.
 */
function ensureMetricsExporterStarted(): void {
  ensureMetricsStateLoaded();
  if (exporterStarted) return;
  const cfg = getExporterConfig();
  if (!cfg.enabled) return;
  exporterStarted = true;
  exporterTimer = setInterval(() => {
    void pushMetricsSnapshot();
  }, cfg.intervalMs);
  exporterTimer.unref?.();
  void pushMetricsSnapshot();
}

/**
 * Normalizes optional labels into a stable, sorted string map.
 */
function normalizeLabels(labels?: LabelValues): Record<string, string> {
  if (!labels) return {};
  const out: Record<string, string> = {};
  Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      out[key] = String(value);
    });
  return out;
}

/**
 * Produces a deterministic key for a normalized label set.
 */
function labelsKey(labels: Record<string, string>): string {
  return Object.entries(labels).map(([k, v]) => `${k}=${v}`).join("|");
}

/**
 * Serializes metric labels into Prometheus text exposition syntax.
 */
function metricLabelsToPrometheus(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (!entries.length) return "";
  const escaped = entries.map(([k, v]) => `${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `{${escaped.join(",")}}`;
}

/**
 * Increments an in-memory counter metric for the provided label set.
 *
 * @param name - Prometheus metric name (counter type).
 * @param labels - Optional dimensional labels attached to the metric sample.
 * @param value - Increment amount. Defaults to `1`.
 * @returns Nothing.
 *
 * @remarks
 * Starts the periodic Pushgateway exporter lazily on first metric write.
 *
 * @example
 * ```typescript
 * incrementCounter("autopilot_requests_total", { route: "/chat", method: "POST" });
 * incrementCounter("autopilot_requests_total", { route: "/chat", method: "POST" }, 2);
 * ```
 */
export function incrementCounter(name: string, labels?: LabelValues, value = 1): void {
  ensureMetricsExporterStarted();
  const norm = normalizeLabels(labels);
  const key = labelsKey(norm);
  const byLabels = counters.get(name) || new Map<string, CounterSample>();
  const current = byLabels.get(key) || { labels: norm, value: 0 };
  current.value += value;
  byLabels.set(key, current);
  counters.set(name, byLabels);
  scheduleSnapshotPersist();
}

/**
 * Records an observation into an in-memory histogram metric.
 *
 * @param name - Prometheus metric name (histogram type).
 * @param value - Observed value to bucket and aggregate.
 * @param labels - Optional dimensional labels attached to the metric sample.
 * @param bucketBounds - Inclusive bucket boundaries in ascending order.
 * @returns Nothing.
 *
 * @remarks
 * Non-finite values are ignored to prevent invalid Prometheus output.
 *
 * @example
 * ```typescript
 * observeHistogram("autopilot_request_duration_ms", 187, { route: "/chat" });
 * ```
 */
export function observeHistogram(
  name: string,
  value: number,
  labels?: LabelValues,
    bucketBounds: number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
): void {
  ensureMetricsExporterStarted();
  if (!Number.isFinite(value)) return;
  const norm = normalizeLabels(labels);
  const key = labelsKey(norm);
  const existing = histograms.get(name) || { bucketBounds, samples: new Map<string, HistogramSample>() };
  const sample = existing.samples.get(key) || {
    labels: norm,
    sum: 0,
    count: 0,
    buckets: Object.fromEntries(existing.bucketBounds.map((b) => [String(b), 0])),
  };
  sample.sum += value;
  sample.count += 1;
  for (const b of existing.bucketBounds) {
    if (value <= b) sample.buckets[String(b)] += 1;
  }
  existing.samples.set(key, sample);
  histograms.set(name, existing);
  scheduleSnapshotPersist();
}

/**
 * Pushes the current metrics snapshot to Pushgateway immediately.
 *
 * @returns Resolves after the best-effort push attempt completes.
 *
 * @remarks
 * Network failures are intentionally swallowed to keep request paths non-fatal.
 *
 * @example
 * ```typescript
 * await flushMetricsExporter();
 * ```
 */
export async function flushMetricsExporter(): Promise<void> {
  ensureMetricsStateLoaded();
  await pushMetricsSnapshot();
  await persistSnapshotNow();
}

/**
 * Stops the background metrics exporter timer.
 *
 * @returns Nothing.
 *
 * @example
 * ```typescript
 * stopMetricsExporter();
 * ```
 */
export function stopMetricsExporter(): void {
  if (exporterTimer) {
    clearInterval(exporterTimer);
    exporterTimer = null;
  }
  if (snapshotPersistTimer) {
    clearTimeout(snapshotPersistTimer);
    snapshotPersistTimer = null;
  }
  exporterStarted = false;
}

/**
 * Renders all in-memory counters and histograms in Prometheus text format.
 *
 * @returns Metrics exposition body suitable for Pushgateway or `/metrics` responses.
 *
 * @example
 * ```typescript
 * const body = renderPrometheusMetrics();
 * console.log(body.includes("# TYPE"));
 * ```
 */
export function renderPrometheusMetrics(): string {
  ensureMetricsStateLoaded();
  const lines: string[] = [];
  lines.push(`# HELP autopilot_uptime_seconds Process uptime in seconds.`);
  lines.push(`# TYPE autopilot_uptime_seconds gauge`);
  lines.push(`autopilot_uptime_seconds ${process.uptime().toFixed(3)}`);

  for (const [name, byLabels] of counters.entries()) {
    lines.push(`# TYPE ${name} counter`);
    for (const sample of byLabels.values()) {
      lines.push(`${name}${metricLabelsToPrometheus(sample.labels)} ${sample.value}`);
    }
  }

  for (const [name, histogram] of histograms.entries()) {
    lines.push(`# TYPE ${name} histogram`);
    for (const sample of histogram.samples.values()) {
      let runningCount = 0;
      for (const bound of histogram.bucketBounds) {
        runningCount = sample.buckets[String(bound)];
        lines.push(`${name}_bucket${metricLabelsToPrometheus({ ...sample.labels, le: String(bound) })} ${runningCount}`);
      }
      lines.push(`${name}_bucket${metricLabelsToPrometheus({ ...sample.labels, le: "+Inf" })} ${sample.count}`);
      lines.push(`${name}_sum${metricLabelsToPrometheus(sample.labels)} ${sample.sum}`);
      lines.push(`${name}_count${metricLabelsToPrometheus(sample.labels)} ${sample.count}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
