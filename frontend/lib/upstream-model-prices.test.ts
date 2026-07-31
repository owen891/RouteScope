import { describe, expect, it } from "vitest"
import type { UpstreamModelPriceItem } from "@/lib/api-types"
import {
  buildUpstreamModelPriceComparisons,
  selectBestUpstreamPriceQuote,
  upstreamPriceScore,
} from "@/lib/upstream-model-prices"

function quote(overrides: Partial<UpstreamModelPriceItem> = {}): UpstreamModelPriceItem {
  return {
    channel_id: 1,
    channel_name: "Site A",
    channel_type: "sub2api",
    source_name: "OpenAI Pool",
    platform: "openai",
    group_id: 1,
    group_name: "Default",
    rate_multiplier: 1,
    peak_rate_enabled: false,
    peak_rate_multiplier: 1,
    model_name: "gpt-test",
    billing_mode: "token",
    tier_label: "Default",
    input_price_per_million: 2,
    output_price_per_million: 8,
    ...overrides,
  }
}

describe("upstream model price aggregation", () => {
  it("selects the lowest combined effective token price", () => {
    const best = selectBestUpstreamPriceQuote([
      quote({ group_id: 1, group_name: "Output cheap", input_price_per_million: 5, output_price_per_million: 3 }),
      quote({ group_id: 2, group_name: "Combined cheap", input_price_per_million: 1, output_price_per_million: 4 }),
    ])

    expect(best?.group_name).toBe("Combined cheap")
    expect(upstreamPriceScore(best!)).toBe(5)
  })

  it("does not present a conditional high-usage tier as the default price", () => {
    const best = selectBestUpstreamPriceQuote([
      quote({ group_name: "Base", input_price_per_million: 2, output_price_per_million: 8 }),
      quote({ group_name: "Over 272K", min_tokens: 272_000, input_price_per_million: 0.1, output_price_per_million: 0.2 }),
    ])

    expect(best?.group_name).toBe("Base")
  })

  it("supports per-request, image-request, and image-token prices", () => {
    expect(upstreamPriceScore(quote({ billing_mode: "per_request", per_request_price: 0.03 }))).toBe(0.03)
    expect(upstreamPriceScore(quote({
      billing_mode: "image",
      per_request_price: 0.04,
      image_input_price_per_million: 1.5,
      image_output_price_per_million: 2.5,
    }))).toBe(0.04)
    expect(upstreamPriceScore(quote({
      input_price_per_million: undefined,
      output_price_per_million: undefined,
      image_input_price_per_million: 1.5,
      image_output_price_per_million: 2.5,
    }))).toBe(4)
  })

  it("always prefers a finite price over a quote without usable pricing", () => {
    const best = selectBestUpstreamPriceQuote([
      quote({ source_name: "A no price", input_price_per_million: undefined, output_price_per_million: undefined }),
      quote({ source_name: "Z priced", input_price_per_million: 2, output_price_per_million: 8 }),
    ])

    expect(best?.source_name).toBe("Z priced")
  })

  it("does not treat a zero-minimum interval as the default tier", () => {
    const best = selectBestUpstreamPriceQuote([
      quote({ group_name: "Base", input_price_per_million: 2, output_price_per_million: 8 }),
      quote({ group_name: "0-200K interval", min_tokens: 0, max_tokens: 200_000, input_price_per_million: 0.1, output_price_per_million: 0.2 }),
    ])

    expect(best?.group_name).toBe("Base")
  })

  it("builds one model row with the best quote for each upstream site", () => {
    const comparisons = buildUpstreamModelPriceComparisons([
      quote({ group_id: 1, group_name: "A expensive", input_price_per_million: 2, output_price_per_million: 8 }),
      quote({ group_id: 2, group_name: "A best", input_price_per_million: 1, output_price_per_million: 4 }),
      quote({
        channel_id: 2,
        channel_name: "Site B",
        group_id: 3,
        group_name: "B only",
        input_price_per_million: 1.5,
        output_price_per_million: 5,
      }),
    ])

    expect(comparisons).toHaveLength(1)
    expect(comparisons[0].sites).toHaveLength(2)
    expect(comparisons[0].sites[0].best.group_name).toBe("A best")
    expect(comparisons[0].sites[1].best.group_name).toBe("B only")
    expect(comparisons[0].quotes).toHaveLength(3)
  })
})
