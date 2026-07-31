import type {
  UpstreamUsageChannel,
  UpstreamUsageError,
  UpstreamUsageGroup,
  UpstreamUsageModel,
  UpstreamUsageTotals,
  UpstreamUsageTrend,
} from "@/lib/api-types"

export interface UpstreamUsageModelRow extends UpstreamUsageModel {
  channel_id: number
  channel_name: string
  channel_type: string
}

export interface UpstreamUsageModelGroup {
  model: string
  rows: UpstreamUsageModelRow[]
  channelCount: number
  actualCost: number
}

export interface UpstreamUsageGroupRow extends UpstreamUsageGroup {
  channel_id: number
  channel_name: string
}

export interface UsageUnitMetrics {
  actualPerMillion: number
  standardPerMillion: number
  actualPerRequest: number
  tokensPerRequest: number
}

export type UsageRecommendationLabel = "\u6027\u4ef7\u6bd4\u6700\u4f73" | "\u7a33\u5b9a\u6027\u6700\u4f73" | "\u7efc\u5408\u63a8\u8350"

export interface ChannelUsageRecommendation extends UsageUnitMetrics {
  channel_id: number
  channel_name: string
  channel_type: string
  requests: number
  total_tokens: number
  actual_cost: number
  average_duration_ms: number
  costScore: number
  stabilityScore: number
  overallScore: number
  eligible: boolean
  unavailable: boolean
  stale: boolean
  labels: UsageRecommendationLabel[]
  reason: string
}

const MIN_RECOMMENDATION_REQUESTS = 20
const MIN_RECOMMENDATION_TOKENS = 1_000_000

export function usageUnitMetrics(totals: UpstreamUsageTotals): UsageUnitMetrics {
  return {
    actualPerMillion: totals.total_tokens > 0 ? totals.actual_cost / totals.total_tokens * 1_000_000 : 0,
    standardPerMillion: totals.total_tokens > 0 ? totals.standard_cost / totals.total_tokens * 1_000_000 : 0,
    actualPerRequest: totals.requests > 0 ? totals.actual_cost / totals.requests : 0,
    tokensPerRequest: totals.requests > 0 ? totals.total_tokens / totals.requests : 0,
  }
}

/** A unit price needs both a request count and token volume to be meaningful. */
export function hasUsagePriceSample(totals: UpstreamUsageTotals): boolean {
  return totals.requests > 0 && totals.total_tokens > 0
}

/** A zero or absent duration is an unknown measurement, not a zero-latency request. */
export function hasUsageDurationSample(totals: UpstreamUsageTotals): boolean {
  const duration = totals.average_duration_ms
  return totals.requests > 0 && duration != null && Number.isFinite(duration) && duration > 0
}

export function buildChannelUsageRecommendations(
  channels: UpstreamUsageChannel[],
  errors: UpstreamUsageError[],
): ChannelUsageRecommendation[] {
  const errorsByChannel = new Map(errors.map((item) => [item.channel_id, item]))
  const positiveLatencies = channels
    .map((channel) => channel.totals.average_duration_ms ?? 0)
    .filter((value) => value > 0)
  const minLatency = positiveLatencies.length > 0 ? Math.min(...positiveLatencies) : 0

  const rows = channels.map((channel) => {
    const metrics = usageUnitMetrics(channel.totals)
    const channelError = errorsByChannel.get(channel.channel_id)
    const unavailable = Boolean(channelError && !channelError.has_stale_data)
    const enoughSamples = channel.totals.requests >= MIN_RECOMMENDATION_REQUESTS &&
      channel.totals.total_tokens >= MIN_RECOMMENDATION_TOKENS
    const validCost = metrics.actualPerMillion > 0 && Number.isFinite(metrics.actualPerMillion)
    const eligible = enoughSamples && validCost && !channelError
    const latency = channel.totals.average_duration_ms ?? 0
    const latencyScore = minLatency > 0 && latency > 0 ? Math.min(100, minLatency / latency * 100) : 50
    const availabilityScore = unavailable ? 0 : channelError ? 40 : channel.stale ? 70 : 100
    const confidenceScore = Math.min(100, channel.totals.requests)
    const stabilityScore = availabilityScore * 0.65 + latencyScore * 0.25 + confidenceScore * 0.1

    let reason = `\u6837\u672c ${channel.totals.requests.toLocaleString("zh-CN")} \u6b21\uff0c\u5e73\u5747\u8017\u65f6 ${formatScoreDuration(latency)}\u3002`
    if (channelError) {
      reason = channelError.has_stale_data
        ? `\u6700\u8fd1\u5237\u65b0\u5931\u8d25\uff0c\u5f53\u524d\u5c55\u793a\u5386\u53f2\u5feb\u7167\uff1a${channelError.error}`
        : `\u8d26\u5355 API \u4e0d\u53ef\u7528\uff0c\u4e0d\u53c2\u4e0e\u63a8\u8350\uff1a${channelError.error}`
    } else if (!enoughSamples) {
      reason = `\u6837\u672c\u4e0d\u8db3\uff08\u9700\u2265${MIN_RECOMMENDATION_REQUESTS} \u6b21\u4e14\u2265${MIN_RECOMMENDATION_TOKENS.toLocaleString("zh-CN")} Token\uff09\uff0c\u4ec5\u4f9b\u89c2\u5bdf\u3002`
    } else if (!validCost) {
      reason = "\u5b9e\u9645\u8d39\u7528\u4e3a 0 \u6216\u6570\u636e\u5f02\u5e38\uff0c\u6682\u4e0d\u53c2\u4e0e\u6392\u540d\u3002"
    } else if (channel.stale) {
      reason = "\u5feb\u7167\u5df2\u8fc7\u671f\uff0c\u540e\u53f0\u6b63\u5728\u5237\u65b0\uff0c\u7a33\u5b9a\u6027\u5206\u5df2\u964d\u6743\u3002"
    }

    return {
      channel_id: channel.channel_id,
      channel_name: channel.channel_name,
      channel_type: channel.channel_type,
      requests: channel.totals.requests,
      total_tokens: channel.totals.total_tokens,
      actual_cost: channel.totals.actual_cost,
      average_duration_ms: latency,
      ...metrics,
      costScore: 0,
      stabilityScore: roundScore(stabilityScore),
      overallScore: 0,
      eligible,
      unavailable,
      stale: channel.stale,
      labels: [],
      reason,
    }
  })

  for (const error of errors) {
    if (rows.some((row) => row.channel_id === error.channel_id)) continue
    rows.push({
      channel_id: error.channel_id,
      channel_name: error.channel_name,
      channel_type: error.channel_type,
      requests: 0,
      total_tokens: 0,
      actual_cost: 0,
      average_duration_ms: 0,
      actualPerMillion: 0,
      standardPerMillion: 0,
      actualPerRequest: 0,
      tokensPerRequest: 0,
      costScore: 0,
      stabilityScore: 0,
      overallScore: 0,
      eligible: false,
      unavailable: true,
      stale: false,
      labels: [],
      reason: `\u8d26\u5355 API \u4e0d\u53ef\u7528\uff0c\u4e0d\u53c2\u4e0e\u63a8\u8350\uff1a${error.error}`,
    })
  }

  const eligibleRows = rows.filter((row) => row.eligible)
  const minUnitCost = eligibleRows.length > 0 ? Math.min(...eligibleRows.map((row) => row.actualPerMillion)) : 0
  for (const row of rows) {
    row.costScore = row.eligible && minUnitCost > 0
      ? roundScore(Math.min(100, minUnitCost / row.actualPerMillion * 100))
      : 0
    row.overallScore = row.eligible
      ? roundScore(row.costScore * 0.6 + row.stabilityScore * 0.4)
      : 0
  }

  assignBestLabel(eligibleRows, "\u6027\u4ef7\u6bd4\u6700\u4f73", (row) => row.costScore)
  assignBestLabel(eligibleRows, "\u7a33\u5b9a\u6027\u6700\u4f73", (row) => row.stabilityScore)
  assignBestLabel(eligibleRows, "\u7efc\u5408\u63a8\u8350", (row) => row.overallScore)

  return rows.sort((a, b) =>
    Number(b.eligible) - Number(a.eligible) ||
    b.overallScore - a.overallScore ||
    b.stabilityScore - a.stabilityScore ||
    a.channel_id - b.channel_id,
  )
}

function assignBestLabel(
  rows: ChannelUsageRecommendation[],
  label: UsageRecommendationLabel,
  score: (row: ChannelUsageRecommendation) => number,
) {
  if (rows.length === 0) return
  const best = [...rows].sort((a, b) => score(b) - score(a) || a.channel_id - b.channel_id)[0]
  best.labels.push(label)
}

function roundScore(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10
}

function formatScoreDuration(value: number) {
  if (!value) return "--"
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(2)}s`
}

export function flattenUsageModels(channels: UpstreamUsageChannel[]): UpstreamUsageModelRow[] {
  return channels
    .flatMap((channel) =>
      (channel.models ?? []).map((model) => ({
        ...model,
        channel_id: channel.channel_id,
        channel_name: channel.channel_name,
        channel_type: channel.channel_type,
      })),
    )
    .sort((a, b) =>
      b.actual_cost - a.actual_cost ||
      b.total_tokens - a.total_tokens ||
      a.model.localeCompare(b.model, "zh-CN", { numeric: true }),
    )
}

export function groupUsageModels(rows: UpstreamUsageModelRow[]): UpstreamUsageModelGroup[] {
  const groups = new Map<string, UpstreamUsageModelRow[]>()
  for (const row of rows) {
    const model = row.model.trim() || "未知模型"
    const current = groups.get(model) ?? []
    current.push(row)
    groups.set(model, current)
  }

  return [...groups.entries()]
    .map(([model, modelRows]) => ({
      model,
      rows: [...modelRows].sort((a, b) =>
        b.actual_cost - a.actual_cost ||
        b.total_tokens - a.total_tokens ||
        a.channel_name.localeCompare(b.channel_name, "zh-CN", { numeric: true }),
      ),
      channelCount: new Set(modelRows.map((row) => row.channel_id)).size,
      actualCost: modelRows.reduce((sum, row) => sum + row.actual_cost, 0),
    }))
    .sort((a, b) =>
      b.actualCost - a.actualCost ||
      a.model.localeCompare(b.model, "zh-CN", { numeric: true }),
    )
}

export function flattenUsageGroups(channels: UpstreamUsageChannel[]): UpstreamUsageGroupRow[] {
  return channels
    .flatMap((channel) =>
      (channel.groups ?? []).map((group) => ({
        ...group,
        channel_id: channel.channel_id,
        channel_name: channel.channel_name,
      })),
    )
    .sort((a, b) => b.actual_cost - a.actual_cost || b.total_tokens - a.total_tokens)
}

export function aggregateUsageTrend(channels: UpstreamUsageChannel[]): UpstreamUsageTrend[] {
  const points = new Map<string, UpstreamUsageTrend>()
  for (const channel of channels) {
    for (const point of channel.trend ?? []) {
      const current = points.get(point.date) ?? {
        date: point.date,
        requests: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 0,
        actual_cost: 0,
        standard_cost: 0,
      }
      current.requests += point.requests
      current.input_tokens += point.input_tokens
      current.output_tokens += point.output_tokens
      current.cache_creation_tokens += point.cache_creation_tokens
      current.cache_read_tokens += point.cache_read_tokens
      current.total_tokens += point.total_tokens
      current.actual_cost += point.actual_cost
      current.standard_cost += point.standard_cost
      points.set(point.date, current)
    }
  }
  return Array.from(points.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function localISODate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function usageDateRange(days: number, now = new Date()): { start: string; end: string } {
  const safeDays = Math.max(1, Math.floor(days))
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  start.setDate(start.getDate() - safeDays + 1)
  return { start: localISODate(start), end: localISODate(end) }
}
