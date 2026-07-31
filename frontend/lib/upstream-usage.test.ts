import { describe, expect, it } from "vitest"
import type { UpstreamUsageChannel, UpstreamUsageError, UpstreamUsageTotals } from "@/lib/api-types"
import {
  aggregateUsageTrend,
  buildChannelUsageRecommendations,
  flattenUsageGroups,
  flattenUsageModels,
  groupUsageModels,
  hasUsageDurationSample,
  hasUsagePriceSample,
  usageDateRange,
  usageUnitMetrics,
} from "@/lib/upstream-usage"

function channel(
  id: number,
  name: string,
  totals: Partial<UpstreamUsageTotals>,
  overrides: Partial<UpstreamUsageChannel> = {},
): UpstreamUsageChannel {
  return {
    channel_id: id,
    channel_name: name,
    channel_type: "sub2api",
    source: "upstream_api",
    start_date: "2026-07-28",
    end_date: "2026-07-29",
    granularity: "day",
    totals: {
      requests: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0,
      actual_cost: 0,
      standard_cost: 0,
      average_duration_ms: 0,
      ...totals,
    },
    models: [],
    groups: [],
    trend: [],
    cached: false,
    stale: false,
    refreshing: false,
    ...overrides,
  }
}

const channels: UpstreamUsageChannel[] = [
  channel(1, "A", { requests: 2, input_tokens: 10, output_tokens: 5, cache_read_tokens: 20, total_tokens: 35, actual_cost: 1, standard_cost: 10 }, {
    models: [{ model: "small", requests: 1, input_tokens: 5, output_tokens: 2, cache_creation_tokens: 0, cache_read_tokens: 3, total_tokens: 10, actual_cost: 0.2, standard_cost: 2 }],
    groups: [{ group_id: 1, group_name: "cheap", requests: 2, total_tokens: 35, actual_cost: 1, standard_cost: 10 }],
    trend: [{ date: "2026-07-29", requests: 2, input_tokens: 10, output_tokens: 5, cache_creation_tokens: 0, cache_read_tokens: 20, total_tokens: 35, actual_cost: 1, standard_cost: 10 }],
  }),
  channel(2, "B", { requests: 1, input_tokens: 2, output_tokens: 1, total_tokens: 3, actual_cost: 2, standard_cost: 4 }, {
    models: [{ model: "large", requests: 1, input_tokens: 2, output_tokens: 1, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 3, actual_cost: 2, standard_cost: 4 }],
    trend: [{ date: "2026-07-29", requests: 1, input_tokens: 2, output_tokens: 1, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 3, actual_cost: 2, standard_cost: 4 }],
  }),
]

function usageError(channelID: number, hasStaleData = false): UpstreamUsageError {
  return {
    channel_id: channelID,
    channel_name: `C${channelID}`,
    channel_type: "sub2api",
    error: "401 expired",
    cached: true,
    retrying: false,
    has_stale_data: hasStaleData,
  }
}

describe("upstream usage helpers", () => {
  it("calculates actual per-million and per-request prices", () => {
    const metrics = usageUnitMetrics({
      requests: 100, input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0,
      total_tokens: 10_000_000, actual_cost: 2, standard_cost: 20,
    })
    expect(metrics.actualPerMillion).toBeCloseTo(0.2)
    expect(metrics.standardPerMillion).toBeCloseTo(2)
    expect(metrics.actualPerRequest).toBeCloseTo(0.02)
    expect(metrics.tokensPerRequest).toBe(100_000)
  })

  it("returns zero unit prices for zero tokens and requests", () => {
    expect(usageUnitMetrics({
      requests: 0, input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0,
      total_tokens: 0, actual_cost: 5, standard_cost: 10,
    })).toEqual({ actualPerMillion: 0, standardPerMillion: 0, actualPerRequest: 0, tokensPerRequest: 0 })
  })

  it("distinguishes zero samples from measured free usage", () => {
    const noSample = {
      requests: 0, input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0,
      total_tokens: 0, actual_cost: 0, standard_cost: 0, average_duration_ms: 0,
    }
    const freeMeasuredSample = { ...noSample, requests: 3, total_tokens: 1200, average_duration_ms: 300 }
    expect(hasUsagePriceSample(noSample)).toBe(false)
    expect(hasUsageDurationSample(noSample)).toBe(false)
    expect(hasUsagePriceSample(freeMeasuredSample)).toBe(true)
    expect(hasUsageDurationSample(freeMeasuredSample)).toBe(true)
  })

  it("separates value, stability and overall recommendations", () => {
    const rows = buildChannelUsageRecommendations([
      channel(1, "cheap", { requests: 100, total_tokens: 10_000_000, actual_cost: 1, standard_cost: 10, average_duration_ms: 2000 }),
      channel(2, "fast", { requests: 100, total_tokens: 10_000_000, actual_cost: 2, standard_cost: 10, average_duration_ms: 1000 }),
    ], [])
    expect(rows.find((row) => row.channel_id === 1)?.labels).toEqual(expect.arrayContaining(["\u6027\u4ef7\u6bd4\u6700\u4f73", "\u7efc\u5408\u63a8\u8350"]))
    expect(rows.find((row) => row.channel_id === 2)?.labels).toContain("\u7a33\u5b9a\u6027\u6700\u4f73")
  })

  it("excludes insufficient samples and failed channels", () => {
    const rows = buildChannelUsageRecommendations([
      channel(1, "small", { requests: 10, total_tokens: 500_000, actual_cost: 0.01, average_duration_ms: 100 }),
      channel(2, "failed", { requests: 100, total_tokens: 10_000_000, actual_cost: 1, average_duration_ms: 100 }),
    ], [usageError(2, true), usageError(3)])
    expect(rows.find((row) => row.channel_id === 1)?.eligible).toBe(false)
    expect(rows.find((row) => row.channel_id === 2)?.eligible).toBe(false)
    expect(rows.find((row) => row.channel_id === 3)?.unavailable).toBe(true)
    expect(rows.every((row) => row.labels.length === 0)).toBe(true)
  })

  it("uses channel id as a stable tie breaker", () => {
    const rows = buildChannelUsageRecommendations([
      channel(2, "second", { requests: 100, total_tokens: 10_000_000, actual_cost: 1, average_duration_ms: 1000 }),
      channel(1, "first", { requests: 100, total_tokens: 10_000_000, actual_cost: 1, average_duration_ms: 1000 }),
    ], [])
    expect(rows[0].channel_id).toBe(1)
    expect(rows[0].labels).toEqual(["\u6027\u4ef7\u6bd4\u6700\u4f73", "\u7a33\u5b9a\u6027\u6700\u4f73", "\u7efc\u5408\u63a8\u8350"])
  })

  it("flattens and sorts model rows by actual cost", () => {
    expect(flattenUsageModels(channels).map((item) => `${item.channel_name}:${item.model}`)).toEqual(["B:large", "A:small"])
  })

  it("groups model rows for channel comparison", () => {
    const rows = flattenUsageModels([
      channel(1, "Channel A", {}, {
        models: [
          { model: "gpt-5.6-sol", requests: 2, input_tokens: 10, output_tokens: 2, cache_creation_tokens: 0, cache_read_tokens: 20, total_tokens: 32, actual_cost: 1, standard_cost: 2 },
          { model: "gpt-5.5", requests: 1, input_tokens: 3, output_tokens: 1, cache_creation_tokens: 0, cache_read_tokens: 5, total_tokens: 9, actual_cost: 0.2, standard_cost: 1 },
        ],
      }),
      channel(2, "Channel B", {}, {
        models: [
          { model: "gpt-5.6-sol", requests: 3, input_tokens: 12, output_tokens: 3, cache_creation_tokens: 0, cache_read_tokens: 25, total_tokens: 40, actual_cost: 2, standard_cost: 4 },
        ],
      }),
    ])

    const groups = groupUsageModels(rows)
    expect(groups.map((group) => `${group.model}:${group.channelCount}`)).toEqual([
      "gpt-5.6-sol:2",
      "gpt-5.5:1",
    ])
    expect(groups[0].rows.map((row) => row.channel_name)).toEqual(["Channel B", "Channel A"])
  })

  it("flattens group rows with channel identity", () => {
    expect(flattenUsageGroups(channels)).toMatchObject([{ channel_name: "A", group_name: "cheap" }])
  })

  it("aggregates trend values across upstreams", () => {
    expect(aggregateUsageTrend(channels)).toEqual([{ date: "2026-07-29", requests: 3, input_tokens: 12, output_tokens: 6, cache_creation_tokens: 0, cache_read_tokens: 20, total_tokens: 38, actual_cost: 3, standard_cost: 14 }])
  })

  it("builds inclusive local date ranges", () => {
    expect(usageDateRange(7, new Date(2026, 6, 29, 23, 0, 0))).toEqual({ start: "2026-07-23", end: "2026-07-29" })
  })
})
