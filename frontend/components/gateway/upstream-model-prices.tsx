import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiFetch } from "@/lib/api"
import type {
  UpstreamModelPriceItem,
  UpstreamModelPricesResponse,
} from "@/lib/api-types"
import { decimal, formatTokens } from "@/lib/format"
import {
  buildUpstreamModelPriceComparisons,
  upstreamPriceScore,
} from "@/lib/upstream-model-prices"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 30

function money(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: value === 0 ? 2 : 0,
    maximumFractionDigits: 6,
  })}`
}

function isRequestBilling(item: UpstreamModelPriceItem) {
  return item.billing_mode === "per_request" || item.billing_mode === "image"
}

function requestUnit(item: UpstreamModelPriceItem) {
  return item.billing_mode === "image" ? "张" : "次"
}

function tierLabel(item: UpstreamModelPriceItem) {
  if (item.billing_mode === "image") {
    return item.tier_label || "图片档"
  }
  if (item.min_tokens == null && item.max_tokens == null) {
    return item.tier_label || "基础档"
  }
  const min = item.min_tokens == null ? "0" : formatTokens(item.min_tokens)
  const max = item.max_tokens == null ? "∞" : formatTokens(item.max_tokens)
  return `${item.tier_label || "阶梯价"} · ${min}-${max}`
}

function effectivePriceLabel(item: UpstreamModelPriceItem) {
  if (isRequestBilling(item) && item.per_request_price != null) {
    return `${money(item.per_request_price)} / ${requestUnit(item)}`
  }
  if (item.input_price_per_million != null || item.output_price_per_million != null) {
    return `入 ${money(item.input_price_per_million)} · 出 ${money(item.output_price_per_million)}`
  }
  if (item.image_input_price_per_million != null || item.image_output_price_per_million != null) {
    return `图像入 ${money(item.image_input_price_per_million)} · 出 ${money(item.image_output_price_per_million)}`
  }
  return "—"
}

function basePriceLabel(item: UpstreamModelPriceItem) {
  if (isRequestBilling(item) && item.base_per_request_price != null) {
    return `${money(item.base_per_request_price)} / ${requestUnit(item)}`
  }
  if (item.base_input_price_per_million != null || item.base_output_price_per_million != null) {
    return `入 ${money(item.base_input_price_per_million)} · 出 ${money(item.base_output_price_per_million)}`
  }
  if (item.base_image_input_price_per_million != null || item.base_image_output_price_per_million != null) {
    return `图像入 ${money(item.base_image_input_price_per_million)} · 出 ${money(item.base_image_output_price_per_million)}`
  }
  return "—"
}

function cachePriceLabel(item: UpstreamModelPriceItem) {
  if (item.cache_write_price_per_million == null && item.cache_read_price_per_million == null) {
    return "—"
  }
  return `写 ${money(item.cache_write_price_per_million)} · 读 ${money(item.cache_read_price_per_million)}`
}

function peakPriceLabel(item: UpstreamModelPriceItem) {
  if (!item.peak_rate_enabled) return "—"
  if (isRequestBilling(item) && item.peak_per_request_price != null) {
    return `${money(item.peak_per_request_price)} / ${requestUnit(item)}`
  }
  if (item.peak_input_price_per_million != null || item.peak_output_price_per_million != null) {
    const cache = item.peak_cache_write_price_per_million != null || item.peak_cache_read_price_per_million != null
      ? ` · Cache 写 ${money(item.peak_cache_write_price_per_million)} / 读 ${money(item.peak_cache_read_price_per_million)}`
      : ""
    return `入 ${money(item.peak_input_price_per_million)} · 出 ${money(item.peak_output_price_per_million)}${cache}`
  }
  if (item.peak_image_input_price_per_million != null || item.peak_image_output_price_per_million != null) {
    return `图像入 ${money(item.peak_image_input_price_per_million)} · 出 ${money(item.peak_image_output_price_per_million)}`
  }
  return "—"
}

function PriceSummary({ item }: { item: UpstreamModelPriceItem }) {
  if (isRequestBilling(item) && item.per_request_price != null) {
    return <div className="font-semibold tabular-nums">{money(item.per_request_price)} / {requestUnit(item)}</div>
  }

  if (item.input_price_per_million != null || item.output_price_per_million != null) {
    return (
      <div className="grid grid-cols-2 gap-x-3 text-xs tabular-nums">
        <div>
          <span className="text-[10px] text-muted-foreground">Input</span>
          <div className="font-semibold">{money(item.input_price_per_million)}</div>
        </div>
        <div>
          <span className="text-[10px] text-muted-foreground">Output</span>
          <div className="font-semibold">{money(item.output_price_per_million)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-x-3 text-xs tabular-nums">
      <div>
        <span className="text-[10px] text-muted-foreground">图像 Input</span>
        <div className="font-semibold">{money(item.image_input_price_per_million)}</div>
      </div>
      <div>
        <span className="text-[10px] text-muted-foreground">图像 Output</span>
        <div className="font-semibold">{money(item.image_output_price_per_million)}</div>
      </div>
    </div>
  )
}

function QuoteDetails({ quotes }: { quotes: UpstreamModelPriceItem[] }) {
  const detailLabelClass = "mb-1 block text-[10px] text-muted-foreground md:hidden"

  return (
    <div className="rounded-md border border-border bg-background text-xs">
      <div className="hidden grid-cols-[minmax(140px,1fr)_minmax(210px,1.4fr)_140px_minmax(170px,1.1fr)_minmax(170px,1.1fr)_minmax(170px,1.1fr)] gap-3 border-b border-border bg-muted/35 px-3 py-2 font-medium text-muted-foreground md:grid">
        <span>上游站点</span>
        <span>内部渠道 / 账号分组</span>
        <span>计价档</span>
        <span>有效价</span>
        <span>基础价 / Cache</span>
        <span>高峰有效价</span>
      </div>
      {quotes.map((item, index) => (
        <div
          key={`${item.channel_id}:${item.source_name}:${item.group_id}:${item.tier_label}:${index}`}
          className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-b border-border/60 px-3 py-3 last:border-b-0 md:grid-cols-[minmax(140px,1fr)_minmax(210px,1.4fr)_140px_minmax(170px,1.1fr)_minmax(170px,1.1fr)_minmax(170px,1.1fr)] md:gap-3 md:py-2.5"
        >
          <span className="min-w-0">
            <span className={detailLabelClass}>上游站点</span>
            <span className="block break-words font-medium" title={item.channel_name}>{item.channel_name}</span>
          </span>
          <span className="min-w-0">
            <span className={detailLabelClass}>内部渠道 / 账号分组</span>
            <span className="block break-words" title={item.source_name}>{item.source_name}</span>
            <span className="block break-words text-[10px] text-muted-foreground" title={item.group_name}>
              {item.group_name} · ×{decimal(item.rate_multiplier, 4)}
            </span>
          </span>
          <span className="min-w-0">
            <span className={detailLabelClass}>计价档</span>
            <span className="block break-words" title={tierLabel(item)}>{tierLabel(item)}</span>
          </span>
          <span className="min-w-0 tabular-nums">
            <span className={detailLabelClass}>有效价</span>
            <span className="block break-words font-medium">{effectivePriceLabel(item)}</span>
          </span>
          <span className="min-w-0 tabular-nums">
            <span className={detailLabelClass}>基础价 / Cache</span>
            <span className="block break-words">{basePriceLabel(item)}</span>
            <span className="block break-words text-[10px] text-muted-foreground">Cache {cachePriceLabel(item)}</span>
          </span>
          <span className={cn("min-w-0 tabular-nums", item.peak_rate_enabled && "text-amber-700 dark:text-amber-400")}>
            <span className={detailLabelClass}>高峰有效价</span>
            <span className="block break-words">{peakPriceLabel(item)}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export function UpstreamModelPrices() {
  const [data, setData] = useState<UpstreamModelPricesResponse>({ items: [], errors: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")
  const [platformFilter, setPlatformFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const loadedRef = useRef(false)

  async function load() {
    setLoading(true)
    setError("")
    try {
      const response = await apiFetch<UpstreamModelPricesResponse>("/channels/model-prices")
      setData({ items: response.items ?? [], errors: response.errors ?? [] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载上游模型价格失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void load()
  }, [])

  const channels = useMemo(() => {
    const values = new Map<number, string>()
    for (const item of data.items) values.set(item.channel_id, item.channel_name)
    return Array.from(values, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "zh-CN", { numeric: true }) || a.id - b.id,
    )
  }, [data.items])

  const platforms = useMemo(() =>
    Array.from(new Set(data.items.map((item) => item.platform.trim() || "unknown")))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
  [data.items])

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.items.filter((item) => {
      if (channelFilter !== "all" && String(item.channel_id) !== channelFilter) return false
      if (platformFilter !== "all" && (item.platform.trim() || "unknown") !== platformFilter) return false
      if (!needle) return true
      return [
        item.model_name,
        item.channel_name,
        item.source_name,
        item.group_name,
        item.tier_label,
      ].some((value) => value.toLowerCase().includes(needle))
    })
  }, [channelFilter, data.items, platformFilter, query])

  const comparisons = useMemo(
    () => buildUpstreamModelPriceComparisons(filteredItems),
    [filteredItems],
  )

  const visibleSites = useMemo(() => {
    const ids = new Set(filteredItems.map((item) => item.channel_id))
    return channels.filter((channel) => ids.has(channel.id))
  }, [channels, filteredItems])

  useEffect(() => setPage(1), [channelFilter, platformFilter, query])

  const pages = Math.max(1, Math.ceil(comparisons.length / PAGE_SIZE))
  const safePage = Math.min(page, pages)
  const visible = comparisons.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">上游模型价格</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            每个模型横向比较各上游的最低可用有效价。有效价 = 基础价 × 当前账号可用分组倍率。Token 类价格单位为美元 / 百万 Token；按次与图片模式显示单次 / 单张价格。
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          刷新价目
        </Button>
      </header>

      <div className="grid gap-3 border-y border-border bg-muted/15 px-3 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(280px,1fr)_220px_240px]">
        <div className="space-y-1.5">
          <Label htmlFor="upstream-model-price-search" className="text-xs text-muted-foreground">模型搜索</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="upstream-model-price-search"
              className="h-9 bg-background pl-8"
              placeholder="模型、内部渠道或分组"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">平台</Label>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="h-9 bg-background" aria-label="模型平台">
              <SelectValue placeholder="全部平台" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部平台</SelectItem>
              {platforms.map((platform) => <SelectItem key={platform} value={platform}>{platform}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          <Label className="text-xs text-muted-foreground">上游站点</Label>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="h-9 bg-background" aria-label="上游站点">
              <SelectValue placeholder="全部上游" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部上游</SelectItem>
              {channels.map((channel) => (
                <SelectItem key={channel.id} value={String(channel.id)}>{channel.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {comparisons.length} 个模型 · {visibleSites.length} 个上游 · {filteredItems.length} 条可用报价
        </span>
        <span>默认价按 Input + Output 综合有效价择优；阶梯价在详情中展示</span>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>
      ) : null}
      {data.errors.length > 0 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {data.errors.length} 个上游读取失败，其余报价仍可比较。
        </div>
      ) : null}

      {loading && data.items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 border border-dashed border-border py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 正在读取上游价目…
        </div>
      ) : visible.length === 0 ? (
        <div className="border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          当前筛选条件下暂无上游模型价格
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-md border border-border md:block" data-testid="upstream-model-price-comparison">
            <Table
              className="table-fixed"
              style={{ minWidth: `${300 + visibleSites.length * 250}px` }}
            >
              <colgroup>
                <col style={{ width: "300px" }} />
                {visibleSites.map((site) => <col key={site.id} style={{ width: "250px" }} />)}
              </colgroup>
              <TableHeader className="bg-muted/35">
                <TableRow className="hover:bg-transparent">
                  <TableHead>模型</TableHead>
                  {visibleSites.map((site) => (
                    <TableHead key={site.id}>
                      <span className="block max-w-[230px] truncate" title={site.name}>{site.name}</span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((comparison) => {
                  const isExpanded = expanded.has(comparison.key)
                  const scores = comparison.sites.map((site) => upstreamPriceScore(site.best))
                  const lowest = Math.min(...scores)
                  return (
                    <Fragment key={comparison.key}>
                      <TableRow>
                        <TableCell className="whitespace-normal align-top py-3">
                          <div className="min-w-0">
                            <div className="truncate font-mono text-xs font-semibold" title={comparison.modelName}>
                              {comparison.modelName}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">{comparison.platform}</Badge>
                              <span className="text-[10px] text-muted-foreground">{comparison.quotes.length} 条报价</span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="mt-1.5 h-7 px-1.5 text-xs text-muted-foreground"
                              onClick={() => toggleExpanded(comparison.key)}
                              aria-expanded={isExpanded}
                            >
                              <ChevronDown className={cn("size-3.5 transition-transform", isExpanded && "rotate-180")} />
                              {isExpanded ? "收起报价" : "查看全部报价"}
                            </Button>
                          </div>
                        </TableCell>
                        {visibleSites.map((site) => {
                          const result = comparison.sites.find((item) => item.channelID === site.id)
                          if (!result) {
                            return <TableCell key={site.id} className="align-top py-3 text-muted-foreground">—</TableCell>
                          }
                          const isLowest = visibleSites.length > 1
                            && Number.isFinite(lowest)
                            && Math.abs(upstreamPriceScore(result.best) - lowest) < 1e-9
                          return (
                            <TableCell key={site.id} className="whitespace-normal align-top py-3">
                              <div className="flex min-h-20 flex-col justify-between gap-2">
                                <PriceSummary item={result.best} />
                                <div className="min-w-0 text-[10px] leading-4 text-muted-foreground">
                                  <div className="truncate" title={`${result.best.source_name} / ${result.best.group_name}`}>
                                    {result.best.source_name} · {result.best.group_name}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span>倍率 ×{decimal(result.best.rate_multiplier, 4)}</span>
                                    {result.best.peak_rate_enabled ? <span className="text-amber-700 dark:text-amber-400">高峰 ×{decimal(result.best.peak_rate_multiplier, 4)}</span> : null}
                                    {isLowest ? <span className="font-medium text-emerald-700 dark:text-emerald-400">最低</span> : null}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          )
                        })}
                      </TableRow>
                      {isExpanded ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={visibleSites.length + 1} className="whitespace-normal bg-muted/15 p-3">
                            <QuoteDetails quotes={comparison.quotes} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-2 md:hidden" data-testid="upstream-model-price-mobile-list">
            {visible.map((comparison) => {
              const isExpanded = expanded.has(comparison.key)
              return (
                <article key={comparison.key} className="rounded-md border border-border">
                  <div className="flex min-w-0 items-start justify-between gap-2 border-b border-border bg-muted/25 px-3 py-2.5">
                    <div className="min-w-0">
                      <h2 className="break-all font-mono text-xs font-semibold">{comparison.modelName}</h2>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{comparison.platform} · {comparison.quotes.length} 条报价</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="-mr-1 -mt-1"
                      onClick={() => toggleExpanded(comparison.key)}
                      aria-label={`${isExpanded ? "收起" : "查看"} ${comparison.modelName} 全部报价`}
                      aria-expanded={isExpanded}
                    >
                      <ChevronDown className={cn("size-4 transition-transform", isExpanded && "rotate-180")} />
                    </Button>
                  </div>
                  <div className="divide-y divide-border/70">
                    {comparison.sites.map((site) => (
                      <div key={site.channelID} className="grid grid-cols-[minmax(0,1fr)_minmax(128px,auto)] gap-3 px-3 py-2.5">
                        <div className="min-w-0 text-xs">
                          <div className="truncate font-medium" title={site.channelName}>{site.channelName}</div>
                          <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={`${site.best.source_name} / ${site.best.group_name}`}>
                            {site.best.source_name} · {site.best.group_name} · ×{decimal(site.best.rate_multiplier, 4)}
                          </div>
                        </div>
                        <PriceSummary item={site.best} />
                      </div>
                    ))}
                  </div>
                  {isExpanded ? <div className="border-t border-border bg-muted/15 p-2"><QuoteDetails quotes={comparison.quotes} /></div> : null}
                </article>
              )
            })}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>第 {safePage} / {pages} 页，每页 {PAGE_SIZE} 个模型</span>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="icon-sm" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="上一页模型价格">
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" disabled={safePage >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} aria-label="下一页模型价格">
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </section>
  )
}
