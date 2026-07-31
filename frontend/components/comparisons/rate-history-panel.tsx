"use client"

import { forwardRef, useMemo } from "react"
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  TrendingUp,
} from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { EmptyState, ErrorState } from "@/components/ops/page-primitives"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { RateChangeLog, RateChangeLogPage, RateSnapshot } from "@/lib/api-types"
import { dateTime, formatRatio, ratioDelta, relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"

type TrendPoint = {
  index: number
  label: string
  ratio: number
  timestamp: string
}

type TooltipPayload = Array<{ payload?: TrendPoint; value?: number }>

function chartTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function buildTrend(items: RateChangeLog[]): TrendPoint[] {
  const ordered = [...items].sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())
  if (ordered.length === 0) return []

  const points: TrendPoint[] = []
  if (ordered[0].old_ratio != null) {
    points.push({
      index: 0,
      label: chartTime(ordered[0].changed_at),
      ratio: ordered[0].old_ratio,
      timestamp: ordered[0].changed_at,
    })
  }
  for (const item of ordered) {
    points.push({
      index: points.length,
      label: chartTime(item.changed_at),
      ratio: item.new_ratio,
      timestamp: item.changed_at,
    })
  }
  return points
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload }) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 shadow-md">
      <p className="text-sm font-semibold text-foreground">{formatRatio(point.ratio)}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{dateTime(point.timestamp)}</p>
    </div>
  )
}

function groupStatus(item: RateChangeLog, currentRates: RateSnapshot[]) {
  if (item.remote_group_id != null) {
    const current = currentRates.find((rate) => rate.remote_group_id === item.remote_group_id)
    if (!current) return "removed" as const
    if (current.model_name !== item.model_name) return "renamed" as const
    return "current" as const
  }
  return currentRates.some((rate) => rate.model_name === item.model_name)
    ? ("current" as const)
    : ("removed" as const)
}

interface RateHistoryPanelProps {
  className?: string
  selectedGroup: RateSnapshot | null
  currentRates: RateSnapshot[]
  data: RateChangeLogPage | null
  loading: boolean
  error: string | null
  page: number
  onPageChange: (page: number) => void
  onClearGroup: () => void
  onRetry: () => void
}

export const RateHistoryPanel = forwardRef<HTMLDivElement, RateHistoryPanelProps>(function RateHistoryPanel({
  className,
  selectedGroup,
  currentRates,
  data,
  loading,
  error,
  page,
  onPageChange,
  onClearGroup,
  onRetry,
}, ref) {
  const items = data?.items ?? []
  const trend = useMemo(() => selectedGroup ? buildTrend(items) : [], [items, selectedGroup])
  const pages = Math.max(1, data?.pages ?? 1)
  const safePage = Math.min(page, pages)

  return (
    <Card
      ref={ref}
      className={cn("min-w-0 gap-0 scroll-mt-20", className)}
      data-testid="rate-change-history"
    >
      <CardHeader className="flex h-14 shrink-0 items-center border-b border-border px-4 pb-0">
        <div className="flex w-full items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <TrendingUp className="size-4 shrink-0" />
            <span className="truncate">{selectedGroup ? `${selectedGroup.model_name} 倍率变化` : "最近变更"}</span>
          </CardTitle>
          {selectedGroup ? (
            <Button type="button" size="sm" variant="ghost" onClick={onClearGroup}>
              全部分组
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {error ? (
          <ErrorState message={`变更历史加载失败：${error}`} onRetry={onRetry} />
        ) : loading && !data ? (
          <div className="h-40 animate-pulse rounded-md border border-border bg-muted/20" />
        ) : items.length === 0 ? (
          <EmptyState
            title={selectedGroup ? `${selectedGroup.model_name} 还没有倍率变化` : "当前渠道还没有倍率变更记录"}
            description="首次采集只保存当前值，后续发生变化才会生成记录。"
          />
        ) : (
          <>
            {selectedGroup && trend.length > 1 ? (
              <div className="h-44 w-full rounded-md border border-border bg-muted/10 px-2 py-3" data-testid="rate-trend-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={28}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    />
                    <YAxis
                      dataKey="ratio"
                      axisLine={false}
                      tickLine={false}
                      width={48}
                      domain={["auto", "auto"]}
                      tickFormatter={formatRatio}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    />
                    <Tooltip content={<TrendTooltip />} cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }} />
                    <Line
                      type="stepAfter"
                      dataKey="ratio"
                      stroke="var(--brand)"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "var(--background)", strokeWidth: 2 }}
                      activeDot={{ r: 4, fill: "var(--brand)", strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}

            <div className="space-y-2">
              {items.map((item) => {
                const delta = ratioDelta(item.old_ratio, item.new_ratio)
                const completionChanged = item.new_completion_ratio != null
                  && item.old_completion_ratio !== item.new_completion_ratio
                const status = groupStatus(item, currentRates)
                return (
                  <div
                    key={item.id}
                    className="border-b border-border/70 py-3 first:pt-0 last:border-b-0 last:pb-0 [content-visibility:auto]"
                    data-testid="rate-change-item"
                  >
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{item.model_name}</p>
                        {status === "renamed" ? <Badge variant="secondary">曾用名</Badge> : null}
                        {status === "removed" ? <Badge variant="outline">已移除</Badge> : null}
                      </div>
                      <Badge variant="outline">
                        <Clock3 className="size-3.5" />
                        {relativeTime(item.changed_at)}
                      </Badge>
                    </div>
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{formatRatio(item.old_ratio)}</span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      <span className="font-semibold text-foreground">{formatRatio(item.new_ratio)}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          delta.direction === "up"
                            ? "border-amber-500/30 text-amber-700 dark:text-amber-300"
                            : "border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
                        )}
                      >
                        {delta.pct}
                      </Badge>
                    </div>
                    {completionChanged ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        补全 {formatRatio(item.old_completion_ratio)} → {formatRatio(item.new_completion_ratio)}
                      </p>
                    ) : null}
                    <p className="mt-2 text-[11px] text-muted-foreground">{dateTime(item.changed_at)}</p>
                  </div>
                )
              })}
            </div>

            {pages > 1 ? (
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">第 {safePage} / {pages} 页</span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label="上一页变更"
                    title="上一页变更"
                    disabled={safePage <= 1}
                    onClick={() => onPageChange(Math.max(1, safePage - 1))}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label="下一页变更"
                    title="下一页变更"
                    disabled={safePage >= pages}
                    onClick={() => onPageChange(Math.min(pages, safePage + 1))}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
})
