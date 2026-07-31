"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Clock3, Link2, Search, ShieldCheck } from "lucide-react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { EmptyState, ErrorState } from "@/components/ops/page-primitives"
import { useContextOverview, useContextTimeline } from "@/lib/queries"
import { dateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ContextField, ContextFreshness, ChannelContext } from "@/lib/context-types"

const fieldNames: Array<{ key: keyof ChannelContext["fields"]; label: string }> = [
  { key: "health", label: "健康" },
  { key: "balance", label: "余额" },
  { key: "rates", label: "倍率" },
  { key: "cost", label: "成本" },
  { key: "ttft", label: "TTFT" },
  { key: "capacity", label: "容量" },
  { key: "incident", label: "近期异常" },
]

const reasonLabels: Record<string, string> = {
  "no health observation has been recorded": "尚未采集健康事实",
  "health observation unavailable": "健康事实暂不可用",
  "channel aggregate and latest balance snapshot disagree": "渠道汇总与最新余额快照不一致",
  "balance snapshot unavailable": "余额快照暂不可用",
  "no balance observation has been recorded": "尚未采集余额事实",
  "balance observation has no readable value": "余额事实缺少可解析数值",
  "TTFT samples unavailable": "TTFT 样本暂不可用",
  "no successful TTFT sample has been recorded": "尚无成功的 TTFT 样本",
  "rate snapshot count unavailable": "倍率快照数量暂不可用",
  "no rate snapshot has been recorded": "尚未采集倍率快照",
  "latest rate snapshot unavailable": "最新倍率快照暂不可用",
  "cost snapshot unavailable": "成本快照暂不可用",
  "no cost snapshot has been recorded": "尚未采集成本快照",
  "sync account capacity unavailable": "Relay 账号容量暂不可用",
  "gateway route capacity unavailable": "Gateway 路由容量暂不可用",
}

function reasonLabel(reason?: string) {
  if (!reason) return "暂无事实"
  return reasonLabels[reason] ?? reason
}

function freshnessLabel(value: ContextFreshness) {
  return {
    fresh: "新鲜",
    stale: "偏旧",
    expired: "过期",
    unknown: "未知",
    missing: "缺失",
  }[value]
}

function confidenceLabel(value: ContextField["confidence"]) {
  return { high: "高置信", medium: "中置信", low: "低置信", none: "无置信" }[value]
}

function valueLabel(field: ContextField) {
  if (field.missing) return reasonLabel(field.reason)
  if (typeof field.value === "number") return field.value.toLocaleString("zh-CN", { maximumFractionDigits: 4 })
  if (typeof field.value === "string") return field.value
  if (Array.isArray(field.value)) return `${field.value.length} 条记录`
  if (field.value && typeof field.value === "object") {
    const value = field.value as Record<string, unknown>
    if (typeof value.status === "string") {
      return { healthy: "健康", unhealthy: "异常" }[value.status] ?? value.status
    }
    if (typeof value.model_count === "number") return `${value.model_count} 个模型`
    if (typeof value.p50_ms === "number") return `p50 ${value.p50_ms}ms / p95 ${value.p95_ms ?? "-"}ms`
    if (typeof value.sync_accounts_total === "number") {
      return `${value.sync_accounts_enabled ?? 0}/${value.sync_accounts_total} 个 Relay 账号`
    }
    return "已聚合"
  }
  return "暂无事实"
}

function FieldBadge({ field }: { field: ContextField }) {
  const variant = field.confidence === "low" || field.freshness === "expired" ? "destructive" : "outline"
  return <Badge variant={variant}>{freshnessLabel(field.freshness)} · {confidenceLabel(field.confidence)}</Badge>
}

function ResourceList({
  items,
  selectedKey,
  onSelect,
}: {
  items: ChannelContext[]
  selectedKey?: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="space-y-1" role="list" aria-label="上下文资源">
      {items.map((item) => {
        const selected = item.resource.key === selectedKey
        return (
          <button
            key={item.resource.key}
            type="button"
            role="listitem"
            aria-current={selected ? "true" : undefined}
            onClick={() => onSelect(item.resource.key)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
              selected ? "border-primary/40 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/40",
            )}
          >
            <span className={cn("size-2 shrink-0 rounded-full", item.issues.length > 0 ? "bg-destructive" : "bg-success")} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{item.channel_name}</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">{item.resource.key}</span>
            </span>
            {item.issues.length > 0 ? <Badge variant="destructive">{item.issues.length}</Badge> : null}
          </button>
        )
      })}
    </div>
  )
}

export default function ContextPage() {
  const [query, setQuery] = useState("")
  const [selectedKey, setSelectedKey] = useState<string>()
  const overview = useContextOverview(1, 50)
  const items = overview.data?.items ?? []
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return items
    return items.filter((item) => `${item.channel_name} ${item.resource.key}`.toLocaleLowerCase().includes(normalized))
  }, [items, query])
  const selected = filteredItems.find((item) => item.resource.key === selectedKey) ?? filteredItems[0]
  const timeline = useContextTimeline({
    resourceKind: selected?.resource.kind,
    resourceID: selected?.resource.id,
    page: 1,
    pageSize: 10,
  })
  const failedEvents = useMemo(
    () => (timeline.data?.items ?? []).filter((item) => item.status === "failed" || item.confidence === "low"),
    [timeline.data?.items],
  )

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm"><Link to="/activity?view=observations">查看采集事实</Link></Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="gap-0 shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">渠道资源</p><p className="mt-1 text-xl font-semibold">{overview.data?.total ?? "-"}</p></CardContent></Card>
        <Card className="gap-0 shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">当前资源事件</p><p className="mt-1 text-xl font-semibold">{timeline.data?.total ?? "-"}</p></CardContent></Card>
        <Card className="gap-0 shadow-none"><CardContent className="p-4"><p className="text-xs text-muted-foreground">失败/低置信事件</p><p className="mt-1 text-xl font-semibold text-destructive">{failedEvents.length}</p></CardContent></Card>
      </div>

      {overview.error ? <ErrorState message={`上下文加载失败：${overview.error}`} /> : null}
      {overview.loading && items.length === 0 ? <div className="h-64 animate-pulse rounded-md border border-border bg-muted/20" /> : null}
      {!overview.loading && items.length === 0 ? <EmptyState title="暂无渠道事实" description="完成一次渠道采集后，字段来源和新鲜度会显示在这里。" /> : null}

      {items.length > 0 ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:self-start">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="搜索上下文资源" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索渠道或资源 Key" className="pl-9" />
            </div>
            <select
              aria-label="选择上下文资源"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm lg:hidden"
              value={selected?.resource.key ?? ""}
              onChange={(event) => setSelectedKey(event.target.value)}
            >
              {filteredItems.map((item) => <option key={item.resource.key} value={item.resource.key}>{item.channel_name} · {item.resource.key}</option>)}
            </select>
            <div className="hidden max-h-[calc(100vh-10rem)] overflow-y-auto lg:block">
              <ResourceList items={filteredItems} selectedKey={selected?.resource.key} onSelect={setSelectedKey} />
            </div>
            {filteredItems.length === 0 ? <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">没有匹配的资源。</p> : null}
          </aside>

          {selected ? (
            <div className="min-w-0 space-y-4">
              <Card className="gap-0 shadow-none" data-testid="context-resource-detail">
                <CardHeader className="border-b border-border py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{selected.channel_name}</CardTitle>
                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{selected.resource.key}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {selected.issues.length > 0 ? <Badge variant="destructive"><AlertTriangle />{selected.issues.length} 个问题</Badge> : <Badge variant="outline"><ShieldCheck />完整</Badge>}
                      <Button asChild size="sm" variant="outline"><Link to={`/ops/channels?channel_id=${selected.resource.id}`}>查看渠道</Link></Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="hidden grid-cols-[4.5rem_minmax(6rem,0.8fr)_minmax(7rem,1fr)_7.5rem_7rem] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-medium text-muted-foreground md:grid">
                    <span>字段</span><span>当前值</span><span>来源</span><span>采样时间</span><span>质量</span>
                  </div>
                  <dl className="divide-y divide-border">
                    {fieldNames.map(({ key, label }) => {
                      const field = selected.fields[key]
                      return (
                        <div key={key} className="grid min-w-0 gap-2 px-4 py-3 md:grid-cols-[4.5rem_minmax(6rem,0.8fr)_minmax(7rem,1fr)_7.5rem_7rem] md:items-center md:gap-3">
                          <dt className="text-xs font-medium text-muted-foreground md:text-sm md:text-foreground">{label}</dt>
                          <dd className="min-w-0 break-words text-sm font-medium">{valueLabel(field)}</dd>
                          <dd className="min-w-0 break-all font-mono text-[11px] text-muted-foreground"><span className="mr-1 md:hidden">来源：</span>{field.source || "-"}</dd>
                          <dd className="text-xs text-muted-foreground"><span className="mr-1 md:hidden">采样：</span>{field.sampled_at ? dateTime(field.sampled_at) : "未提供"}</dd>
                          <dd><FieldBadge field={field} /></dd>
                        </div>
                      )
                    })}
                  </dl>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                    <Link2 className="size-3.5" />
                    <span>{selected.links.length} 个跨域关联</span>
                    <span>·</span>
                    <span>生成于 {dateTime(selected.generated_at)}</span>
                  </div>
                </CardContent>
              </Card>

              <section className="space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-base font-semibold">资源时间线</h2>
                  <span className="text-xs text-muted-foreground">最近 10 条 · 原始表来源不被隐藏</span>
                </div>
                <Card className="gap-0 shadow-none">
                  <CardContent className="p-0">
                    {timeline.error ? <p className="p-4 text-sm text-destructive">时间线加载失败：{timeline.error}</p> : null}
                    {timeline.loading && !timeline.data ? <p className="p-4 text-sm text-muted-foreground">加载时间线...</p> : null}
                    {!timeline.loading && (timeline.data?.items.length ?? 0) === 0 ? <p className="p-4 text-sm text-muted-foreground">该资源暂无时间线事件。</p> : null}
                    <div className="divide-y divide-border">
                      {(timeline.data?.items ?? []).map((event) => (
                        <div key={event.id} className="grid min-w-0 gap-2 p-4 md:grid-cols-[10rem_8rem_minmax(0,1fr)_auto] md:items-center">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />{dateTime(event.occurred_at)}</div>
                          <div className="flex items-center gap-2"><Badge variant={event.status === "failed" ? "destructive" : "outline"}>{event.kind}</Badge><span className="truncate text-xs text-muted-foreground">{event.action}</span></div>
                          <div className="min-w-0"><p className="break-words text-sm">{event.summary || "未提供摘要"}</p><p className="break-all font-mono text-[11px] text-muted-foreground">{event.source}</p></div>
                          <Badge variant="outline">{confidenceLabel(event.confidence)}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </section>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
