"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  ArrowUpRight,
  Check,
  RefreshCw,
  Search,
} from "lucide-react"
import { RateHistoryPanel } from "@/components/comparisons/rate-history-panel"
import { EmptyState, ErrorState } from "@/components/ops/page-primitives"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Channel, RateSnapshot } from "@/lib/api-types"
import { channelTypeLabel, dateTime, formatRatio, relativeTime } from "@/lib/format"
import { useChannelRateSummaries, useChannelRates, useChannels, useRateChanges } from "@/lib/queries"
import { cn } from "@/lib/utils"

type ChannelRateSummary = {
  channel: Channel
  rates: RateSnapshot[]
  latestSeenAt: string | null
}

function latestSeenAt(rates: RateSnapshot[]) {
  let latest: string | null = null
  let latestTs = Number.NEGATIVE_INFINITY

  for (const rate of rates) {
    const ts = new Date(rate.last_seen_at).getTime()
    if (Number.isFinite(ts) && ts > latestTs) {
      latestTs = ts
      latest = rate.last_seen_at
    }
  }

  return latest
}

function ratioRange(rates: RateSnapshot[]) {
  if (rates.length === 0) return { minRatio: null, maxRatio: null }

  let minRatio = Number.POSITIVE_INFINITY
  let maxRatio = Number.NEGATIVE_INFINITY
  for (const rate of rates) {
    if (rate.ratio < minRatio) minRatio = rate.ratio
    if (rate.ratio > maxRatio) maxRatio = rate.ratio
  }

  return {
    minRatio: Number.isFinite(minRatio) ? minRatio : null,
    maxRatio: Number.isFinite(maxRatio) ? maxRatio : null,
  }
}

function groupKey(rate: Pick<RateSnapshot, "model_name" | "remote_group_id">) {
  return rate.remote_group_id != null ? `id:${rate.remote_group_id}` : `name:${rate.model_name}`
}

function MetricCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 bg-card px-3 py-3 sm:px-4">
      <p className="text-[10px] font-medium text-muted-foreground sm:text-[11px]">{label}</p>
      <p className="mt-1 truncate text-base font-semibold text-foreground sm:text-lg" title={value}>{value}</p>
      {hint ? <p className="mt-1 truncate text-[10px] text-muted-foreground sm:text-xs" title={hint}>{hint}</p> : null}
    </div>
  )
}

export default function ComparisonsPage() {
  const channelsQuery = useChannels()
  const channels = channelsQuery.data ?? []
  const summaryRatesQuery = useChannelRateSummaries(channels.map((channel) => channel.id))
  const [channelQuery, setChannelQuery] = useState("")
  const [groupQuery, setGroupQuery] = useState("")
  const [selectedChannelID, setSelectedChannelID] = useState<number | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<RateSnapshot | null>(null)
  const [changePage, setChangePage] = useState(1)
  const historyRef = useRef<HTMLDivElement>(null)
  const pendingHistoryScrollRef = useRef(false)

  const channelSummaries = useMemo<ChannelRateSummary[]>(() => {
    const grouped = new Map<number, RateSnapshot[]>()
    for (const rate of summaryRatesQuery.data ?? []) {
      const list = grouped.get(rate.channel_id) ?? []
      list.push(rate)
      grouped.set(rate.channel_id, list)
    }

    return channels.map((channel) => {
      const rates = grouped.get(channel.id) ?? []
      return {
        channel,
        rates,
        latestSeenAt: latestSeenAt(rates),
      }
    })
  }, [channels, summaryRatesQuery.data])

  const filteredChannels = useMemo(() => {
    const needle = channelQuery.trim().toLocaleLowerCase()
    if (!needle) return channelSummaries

    return channelSummaries.filter((summary) => {
      const haystack = [
        summary.channel.name,
        channelTypeLabel(summary.channel.type),
        ...summary.rates.map((rate) => `${rate.model_name} ${rate.description ?? ""}`),
      ]
        .join(" ")
        .toLocaleLowerCase()
      return haystack.includes(needle)
    })
  }, [channelQuery, channelSummaries])

  useEffect(() => {
    if (filteredChannels.length === 0) {
      setSelectedChannelID(null)
      return
    }
    if (!filteredChannels.some((summary) => summary.channel.id === selectedChannelID)) {
      setSelectedChannelID(filteredChannels[0].channel.id)
    }
  }, [filteredChannels, selectedChannelID])

  useEffect(() => {
    setSelectedGroup(null)
    setGroupQuery("")
    setChangePage(1)
  }, [selectedChannelID])

  const selectedSummary = filteredChannels.find((summary) => summary.channel.id === selectedChannelID) ?? filteredChannels[0] ?? null
  const selectedRatesQuery = useChannelRates(selectedSummary?.channel.id ?? null)
  const selectedChangesQuery = useRateChanges(
    changePage,
    20,
    selectedSummary?.channel.id ?? undefined,
    selectedGroup?.model_name,
    selectedGroup?.remote_group_id ?? undefined,
  )

  const selectedRates = selectedRatesQuery.data ?? selectedSummary?.rates ?? []
  const selectedRange = ratioRange(selectedRates)
  const visibleRates = useMemo(() => {
    const needle = groupQuery.trim().toLocaleLowerCase()
    const list = [...selectedRates].sort((a, b) => {
      const timeDiff = new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
      if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff
      return a.model_name.localeCompare(b.model_name, "zh-CN", { numeric: true })
    })
    if (!needle) return list
    return list.filter((rate) => `${rate.model_name} ${rate.description ?? ""}`.toLocaleLowerCase().includes(needle))
  }, [groupQuery, selectedRates])

  const totalRates = channelSummaries.reduce((sum, summary) => sum + summary.rates.length, 0)
  const loading = channelsQuery.loading || summaryRatesQuery.loading
  const error = channelsQuery.error ?? summaryRatesQuery.error

  useEffect(() => {
    if (!selectedGroup || !pendingHistoryScrollRef.current) return

    const frame = window.requestAnimationFrame(() => {
      pendingHistoryScrollRef.current = false
      historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedGroup])

  function handleSelectGroup(rate: RateSnapshot) {
    pendingHistoryScrollRef.current = window.matchMedia("(max-width: 1535px)").matches
    setSelectedGroup(rate)
    setChangePage(1)
  }

  return (
    <section className="space-y-4">
      {loading && !channelsQuery.data ? (
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="h-64 animate-pulse rounded-md border border-border bg-muted/20" />
          <div className="space-y-4">
            <div className="h-36 animate-pulse rounded-md border border-border bg-muted/20" />
            <div className="h-80 animate-pulse rounded-md border border-border bg-muted/20" />
          </div>
        </div>
      ) : error ? (
        <ErrorState message={`倍率快照加载失败：${error}`} onRetry={() => { channelsQuery.refetch(); summaryRatesQuery.refetch() }} />
      ) : totalRates === 0 ? (
        <EmptyState
          title="还没有倍率快照"
          description="先回总览同步渠道倍率，或者去采集事实页看是否抓取失败。"
          action={(
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild size="sm"><Link to="/">去总览同步倍率</Link></Button>
              <Button asChild size="sm" variant="outline"><Link to="/activity?view=observations">查看采集与健康</Link></Button>
            </div>
          )}
        />
      ) : filteredChannels.length === 0 ? (
        <EmptyState
          title="没有匹配的渠道或分组"
          description={`没有找到与“${channelQuery}”匹配的内容。`}
          action={<Button size="sm" variant="outline" onClick={() => setChannelQuery("")}>清空搜索</Button>}
        />
      ) : (
        <div className="min-w-0 space-y-4 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:space-y-0 lg:overflow-hidden lg:rounded-md lg:border lg:border-border lg:bg-card 2xl:h-[calc(100svh-6.5rem)] 2xl:min-h-[40rem] 2xl:grid-cols-[17rem_minmax(0,1fr)_23rem] 2xl:grid-rows-1">
          <div className="min-w-0 space-y-2 lg:hidden">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="搜索渠道"
                className="pl-9"
                value={channelQuery}
                onChange={(event) => setChannelQuery(event.target.value)}
                placeholder="搜索渠道"
              />
            </div>
            <Label htmlFor="comparison-channel" className="sr-only">选择渠道</Label>
            <select
              id="comparison-channel"
              aria-label="选择渠道"
              value={selectedSummary?.channel.id ? String(selectedSummary.channel.id) : ""}
              onChange={(event) => setSelectedChannelID(Number(event.target.value))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {filteredChannels.map((summary) => (
                <option key={summary.channel.id} value={summary.channel.id}>
                  {summary.channel.name} · {summary.rates.length} 个分组
                </option>
              ))}
            </select>
          </div>

          <aside className="hidden min-h-0 min-w-0 lg:row-span-2 lg:flex lg:flex-col lg:border-r lg:border-border 2xl:row-span-1">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <h2 className="text-sm font-semibold text-foreground">上游渠道</h2>
              <Badge variant="secondary">{filteredChannels.length}</Badge>
            </div>
            <div className="shrink-0 border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="搜索渠道"
                  className="h-8 pl-8 text-xs"
                  value={channelQuery}
                  onChange={(event) => setChannelQuery(event.target.value)}
                  placeholder="搜索渠道"
                />
              </div>
            </div>
            <div className="max-h-[70vh] min-h-0 space-y-0.5 overflow-y-auto p-2 2xl:max-h-none 2xl:flex-1">
              {filteredChannels.map((summary) => {
                const selected = summary.channel.id === selectedSummary?.channel.id
                return (
                  <button
                    key={summary.channel.id}
                    type="button"
                    onClick={() => setSelectedChannelID(summary.channel.id)}
                    className={cn(
                      "w-full border-l-2 px-3 py-2.5 text-left outline-none transition-colors focus-visible:bg-muted",
                      selected ? "border-l-primary bg-primary/5" : "border-l-transparent hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{summary.channel.name}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {channelTypeLabel(summary.channel.type)} · {summary.rates.length} 个分组
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {summary.latestSeenAt ? relativeTime(summary.latestSeenAt) : "未采样"}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-md border border-border bg-card lg:col-start-2 lg:row-start-1 lg:rounded-none lg:border-0 2xl:flex 2xl:min-h-0 2xl:flex-col 2xl:border-r 2xl:border-border">
            <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-base font-semibold text-foreground">{selectedSummary?.channel.name ?? "—"}</h2>
                {selectedSummary ? <Badge variant="outline">{channelTypeLabel(selectedSummary.channel.type)}</Badge> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
                  <Link to={`/activity?view=observations&channel_id=${selectedSummary?.channel.id ?? ""}&kind=rate`}>
                    采集记录
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="刷新倍率"
                  title="刷新倍率"
                  onClick={() => {
                    summaryRatesQuery.refetch()
                    selectedRatesQuery.refetch()
                    selectedChangesQuery.refetch()
                  }}
                >
                  <RefreshCw className="size-4" />
                </Button>
              </div>
            </header>

            {selectedSummary ? (
              <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border lg:grid-cols-4">
                <MetricCell label="分组数" value={String(selectedRates.length)} />
                <MetricCell label="倍率范围" value={`${formatRatio(selectedRange.minRatio)} - ${formatRatio(selectedRange.maxRatio)}`} />
                <MetricCell
                  label="最近采样"
                  value={selectedSummary.latestSeenAt ? relativeTime(selectedSummary.latestSeenAt) : "—"}
                  hint={selectedSummary.latestSeenAt ? dateTime(selectedSummary.latestSeenAt) : undefined}
                />
                <MetricCell label={selectedGroup ? "该组变更" : "渠道变更"} value={String(selectedChangesQuery.data?.total ?? 0)} />
              </div>
            ) : null}

            <div className="flex shrink-0 flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">分组</h3>
                <Badge variant="secondary">{visibleRates.length}</Badge>
              </div>
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="搜索当前渠道分组"
                  className="h-8 pl-9 text-xs"
                  value={groupQuery}
                  onChange={(event) => setGroupQuery(event.target.value)}
                  placeholder="搜索分组"
                />
              </div>
            </div>

            <div className="min-w-0 2xl:min-h-0 2xl:flex-1 2xl:overflow-y-auto">
                  {selectedRatesQuery.error ? (
                    <div className="p-4"><ErrorState message={`当前渠道分组加载失败：${selectedRatesQuery.error}`} onRetry={selectedRatesQuery.refetch} /></div>
                  ) : selectedRatesQuery.loading && !selectedRatesQuery.data ? (
                    <div className="m-4 h-56 animate-pulse rounded-md border border-border bg-muted/20" />
                  ) : visibleRates.length === 0 ? (
                    <div className="p-4">
                      <EmptyState
                        title={groupQuery ? "当前渠道里没有匹配分组" : "当前渠道还没有分组快照"}
                        description={groupQuery ? `没有找到与“${groupQuery}”匹配的分组。` : "该渠道还没有采集到倍率。"}
                      />
                    </div>
                  ) : (
                    <div className="max-w-full overflow-hidden">
                      <table className="w-full table-fixed text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-muted/80 text-muted-foreground backdrop-blur [&_th]:whitespace-nowrap">
                          <tr>
                            <th className="w-[48%] px-3 py-2.5 font-medium sm:w-[28%]">上游分组名</th>
                            <th className="hidden w-[30%] px-3 py-2.5 font-medium sm:table-cell">描述</th>
                            <th className="w-[18%] px-2 py-2.5 font-medium sm:w-[12%]">倍率</th>
                            <th className="hidden w-[12%] px-2 py-2.5 font-medium md:table-cell">补全倍率</th>
                            <th className="hidden w-[18%] px-3 py-2.5 font-medium xl:table-cell">首次见到</th>
                            <th className="w-[34%] px-3 py-2.5 font-medium sm:w-[30%] md:w-[18%] xl:w-auto">最近见到</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleRates.map((rate) => {
                            const selected = selectedGroup != null && groupKey(rate) === groupKey(selectedGroup)
                            return (
                              <tr
                                key={`${rate.channel_id}-${groupKey(rate)}`}
                                tabIndex={0}
                                aria-label={`${rate.model_name}，查看倍率变化`}
                                onClick={() => handleSelectGroup(rate)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault()
                                    handleSelectGroup(rate)
                                  }
                                }}
                                className={cn(
                                  "cursor-pointer border-t border-border/70 align-top outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/50",
                                  selected && "bg-primary/5 hover:bg-primary/10",
                                )}
                              >
                                <td className={cn("border-l-2 px-3 py-3 font-medium text-foreground", selected ? "border-l-primary" : "border-l-transparent")}>
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span className={cn(
                                      "flex size-4 shrink-0 items-center justify-center rounded-full border",
                                      selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                                    )}>
                                      {selected ? <Check className="size-3" /> : null}
                                    </span>
                                    <span className="truncate" title={rate.model_name}>{rate.model_name}</span>
                                  </span>
                                </td>
                                <td className="hidden truncate px-3 py-3 text-muted-foreground sm:table-cell" title={rate.description || undefined}>{rate.description || "—"}</td>
                                <td className="px-2 py-3 font-medium tabular-nums">{formatRatio(rate.ratio)}</td>
                                <td className="hidden px-2 py-3 tabular-nums md:table-cell">{formatRatio(rate.completion_ratio)}</td>
                                <td className="hidden whitespace-nowrap px-3 py-3 xl:table-cell">
                                  <div className="font-medium text-foreground">{relativeTime(rate.first_seen_at)}</div>
                                  <div className="mt-1 text-[11px] text-muted-foreground">{dateTime(rate.first_seen_at)}</div>
                                </td>
                                <td className="whitespace-nowrap px-3 py-3">
                                  <div className="font-medium text-foreground">{relativeTime(rate.last_seen_at)}</div>
                                  <div className="mt-1 hidden text-[11px] text-muted-foreground sm:block">{dateTime(rate.last_seen_at)}</div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
            </div>
          </section>

          <RateHistoryPanel
            ref={historyRef}
            className="lg:col-start-2 lg:row-start-2 lg:rounded-none lg:border-x-0 lg:border-b-0 2xl:col-start-3 2xl:row-start-1 2xl:h-full 2xl:min-h-0 2xl:rounded-none 2xl:border-0"
            selectedGroup={selectedGroup}
            currentRates={selectedRates}
            data={selectedChangesQuery.data}
            loading={selectedChangesQuery.loading}
            error={selectedChangesQuery.error}
            page={changePage}
            onPageChange={setChangePage}
            onClearGroup={() => {
              setSelectedGroup(null)
              setChangePage(1)
            }}
            onRetry={selectedChangesQuery.refetch}
          />
        </div>
      )}
    </section>
  )
}
