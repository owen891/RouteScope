import type { UpstreamModelPriceItem } from "@/lib/api-types"

export interface UpstreamPriceSiteComparison {
  channelID: number
  channelName: string
  best: UpstreamModelPriceItem
  quotes: UpstreamModelPriceItem[]
}

export interface UpstreamModelPriceComparison {
  key: string
  modelName: string
  platform: string
  sites: UpstreamPriceSiteComparison[]
  quotes: UpstreamModelPriceItem[]
}

function finite(value?: number) {
  return value != null && Number.isFinite(value) ? value : null
}

/**
 * Returns a unitless ordering score within one model. Token and image prices
 * use input + output; request-based models use their per-request price.
 */
function isRequestBilling(item: UpstreamModelPriceItem) {
  return item.billing_mode === "per_request" || item.billing_mode === "image"
}

export function upstreamPriceScore(item: UpstreamModelPriceItem) {
  if (isRequestBilling(item)) {
    return finite(item.per_request_price) ?? Number.POSITIVE_INFINITY
  }

  const input = finite(item.input_price_per_million)
  const output = finite(item.output_price_per_million)
  if (input != null || output != null) return (input ?? 0) + (output ?? 0)

  const imageInput = finite(item.image_input_price_per_million)
  const imageOutput = finite(item.image_output_price_per_million)
  if (imageInput != null || imageOutput != null) {
    return (imageInput ?? 0) + (imageOutput ?? 0)
  }

  return finite(item.per_request_price) ?? Number.POSITIVE_INFINITY
}

function isBaseTier(item: UpstreamModelPriceItem) {
  return item.min_tokens == null && item.max_tokens == null
}

function comparePriceValues(a: number, b: number) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function compareQuotes(a: UpstreamModelPriceItem, b: UpstreamModelPriceItem) {
  const score = comparePriceValues(upstreamPriceScore(a), upstreamPriceScore(b))
  if (score !== 0) return score

  const output = comparePriceValues(
    finite(a.output_price_per_million) ?? Number.POSITIVE_INFINITY,
    finite(b.output_price_per_million) ?? Number.POSITIVE_INFINITY,
  )
  if (output !== 0) return output

  const input = comparePriceValues(
    finite(a.input_price_per_million) ?? Number.POSITIVE_INFINITY,
    finite(b.input_price_per_million) ?? Number.POSITIVE_INFINITY,
  )
  if (input !== 0) return input

  return a.source_name.localeCompare(b.source_name, "zh-CN", { numeric: true })
    || a.group_name.localeCompare(b.group_name, "zh-CN", { numeric: true })
    || a.group_id - b.group_id
}

/** Chooses the cheapest account-available base-tier quote for one upstream site. */
export function selectBestUpstreamPriceQuote(items: UpstreamModelPriceItem[]) {
  if (items.length === 0) return null
  const baseTier = items.filter(isBaseTier)
  const candidates = baseTier.length > 0 ? baseTier : items
  return [...candidates].sort(compareQuotes)[0]
}

export function buildUpstreamModelPriceComparisons(
  items: UpstreamModelPriceItem[],
): UpstreamModelPriceComparison[] {
  const models = new Map<string, UpstreamModelPriceItem[]>()

  for (const item of items) {
    const platform = item.platform.trim() || "unknown"
    const key = `${platform}\u0000${item.model_name}`
    const quotes = models.get(key)
    if (quotes) quotes.push(item)
    else models.set(key, [item])
  }

  return Array.from(models, ([key, quotes]) => {
    const bySite = new Map<number, UpstreamModelPriceItem[]>()
    for (const quote of quotes) {
      const siteQuotes = bySite.get(quote.channel_id)
      if (siteQuotes) siteQuotes.push(quote)
      else bySite.set(quote.channel_id, [quote])
    }

    const sites = Array.from(bySite, ([channelID, siteQuotes]) => ({
      channelID,
      channelName: siteQuotes[0].channel_name,
      best: selectBestUpstreamPriceQuote(siteQuotes)!,
      quotes: [...siteQuotes].sort(compareQuotes),
    })).sort((a, b) =>
      a.channelName.localeCompare(b.channelName, "zh-CN", { numeric: true })
      || a.channelID - b.channelID,
    )

    return {
      key,
      modelName: quotes[0].model_name,
      platform: quotes[0].platform.trim() || "unknown",
      sites,
      quotes: [...quotes].sort((a, b) =>
        a.channel_name.localeCompare(b.channel_name, "zh-CN", { numeric: true })
        || compareQuotes(a, b),
      ),
    }
  }).sort((a, b) =>
    a.modelName.localeCompare(b.modelName, "en", { numeric: true })
    || a.platform.localeCompare(b.platform, "en", { numeric: true }),
  )
}
