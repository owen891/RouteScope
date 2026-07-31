"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Gift,
  ChevronsLeft,
  ChevronsRight,
  Grid2X2,
  List,
  XCircle,
  FileUp,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useChannelRateSummaries, useChannels, useChannelsPage } from "@/lib/queries"
import { apiFetch } from "@/lib/api"
import { useRefreshTick, useTriggerRefresh } from "@/lib/refresh-context"
import { channelTypeLabel, decimal, formatDurationMS, formatRatio, formatTokens, money, relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { syncAllChannelsStream, syncChannelStream, testLoginStream, type ProgressEvent } from "@/lib/sync-stream"
import type { Channel, ChannelRedeemResult, CredentialMode, RateSnapshot, UpstreamUsageResponse } from "@/lib/api-types"
import { ChannelFormDialog } from "@/components/monitor/channel-form-dialog"
import { ChannelImportDialog } from "@/components/monitor/channel-import-dialog"
import { ChannelRedeemDialog } from "@/components/monitor/channel-redeem-dialog"
import { ChannelRechargeDialog } from "@/components/monitor/channel-recharge-dialog"
import {
  ChannelAPIKeysDialog,
  type ChannelAPIKeyInitialAction,
} from "@/components/monitor/channel-api-keys-dialog"
import {
  ChannelSubscriptionUsageMetricTiles,
} from "@/components/monitor/channel-subscription-usage-dialog"
import { parseChannelExtra } from "@/lib/channel-extra"
import {
  CHANNEL_ERROR_FILTERS,
  classifyChannelError,
  type ChannelErrorKind,
} from "@/lib/channel-error"
import { hasUsageDurationSample, hasUsagePriceSample, usageDateRange, usageUnitMetrics } from "@/lib/upstream-usage"

type Status = "healthy" | "low" | "failed" | "idle"
type ChannelPageSize = 9 | 18 | 36 | 72 | 81 | "all"
type ChannelViewMode = "cards" | "list"
type ChannelSortKey = "balance" | "actualPrice" | "usage" | "latency" | "todayCost"
type ChannelSortDirection = "asc" | "desc"
type ChannelSortState = { key: ChannelSortKey; direction: ChannelSortDirection } | null

const channelPageSizeOptions: ChannelPageSize[] = [9, 18, 36, 72, 81, "all"]

function pageNumbers(currentPage: number, totalPages: number) {
  const first = Math.max(1, currentPage - 3)
  const last = Math.min(totalPages, currentPage + 3)
  return Array.from({ length: last - first + 1 }, (_, i) => first + i)
}

function statusOf(c: Channel): Status {
  if (c.last_error) return "failed"
  if (c.last_balance == null) return "idle"
  if (c.balance_threshold > 0 && c.last_balance < c.balance_threshold) return "low"
  return "healthy"
}

const statusMap: Record<Status, { label: string; cls: string }> = {
  healthy: { label: "健康", cls: "text-success bg-success/10 ring-success/25" },
  low: { label: "低余额", cls: "text-warning bg-warning/10 ring-warning/25" },
  failed: { label: "登录失败", cls: "text-danger bg-danger/10 ring-danger/25" },
  idle: { label: "尚未采集", cls: "text-muted-foreground bg-muted/70 ring-border" },
}

function failedStatusLabel(c: Channel): string {
  const info = classifyChannelError(c.last_error)
  return info.kind === "none" || info.kind === "other" ? "登录失败" : info.label
}

function StatTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-16 min-w-0 flex-col justify-between rounded-md border border-border bg-muted/20 px-2.5 py-2">
      <span className="text-[10px] leading-none text-muted-foreground">{label}</span>
      <div className="min-w-0 overflow-hidden text-[13px] font-semibold leading-tight text-foreground">
        {typeof children === "string" ? <span className="block truncate">{children}</span> : children}
      </div>
    </div>
  )
}

function SortableChannelHead({
  children,
  label,
  sortKey,
  sortState,
  onSort,
  className,
  align = "center",
}: {
  children: React.ReactNode
  label: string
  sortKey: ChannelSortKey
  sortState: ChannelSortState
  onSort: (key: ChannelSortKey) => void
  className?: string
  align?: "left" | "center"
}) {
  const active = sortState?.key === sortKey
  const direction = active ? sortState.direction : null
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown
  const sortLabel = active
    ? `当前按${label}${direction === "asc" ? "升序" : "降序"}，再次点击切换`
    : `按${label}排序`

  return (
    <TableHead
      className={cn("h-10 p-0", className)}
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        className={cn(
          "flex min-h-10 w-full items-center gap-1 px-3 py-2 text-[inherit] transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          align === "left" ? "justify-start" : "justify-center",
        )}
        aria-label={sortLabel}
        title={sortLabel}
        onClick={() => onSort(sortKey)}
      >
        <span>{children}</span>
        <Icon className={cn("size-3.5 shrink-0", active ? "text-foreground" : "text-muted-foreground/70")} aria-hidden="true" />
      </button>
    </TableHead>
  )
}

function channelSortValue(
  channel: Channel,
  key: ChannelSortKey,
  usageByChannel: Map<number, UpstreamUsageResponse["channels"][number]>,
): number | null {
  if (key === "balance") return channel.last_balance ?? null
  if (key === "todayCost") return channel.today_cost ?? null

  const usage = usageByChannel.get(channel.id)
  if (!usage) return null
  if (key === "usage") return usage.totals.total_tokens
  if (key === "latency") {
    return hasUsageDurationSample(usage.totals) ? usage.totals.average_duration_ms ?? null : null
  }
  return hasUsagePriceSample(usage.totals) ? usageUnitMetrics(usage.totals).actualPerMillion : null
}

function compareChannelSortValues(
  a: number | null,
  b: number | null,
  direction: ChannelSortDirection,
): number {
  const aMissing = a == null || !Number.isFinite(a)
  const bMissing = b == null || !Number.isFinite(b)
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0
    return aMissing ? 1 : -1
  }
  const result = a - b
  return direction === "asc" ? result : -result
}

function rechargeMultiplierTip(c: Channel) {
  const mode = c.recharge_multiplier_mode === "multiply" ? "余额 × 倍率" : "余额 / 倍率"
  if (c.recharge_multiplier != null && c.recharge_multiplier > 0) {
    return `充值倍率：${decimal(c.recharge_multiplier, 4)}（${mode}）`
  }
  return `充值倍率：跟随上游（${mode}）`
}

/** Keep rate chips neutral but distinct; status colors remain reserved for health. */
function ratioTone(): string {
  return "bg-foreground/[0.055] text-foreground ring-foreground/15"
}

/** InlineRates 在渠道卡片内部展示当前所有分组倍率，默认 2 行折叠 + 展开按钮。 */
function InlineRates({ rates: data, loading }: { rates?: RateSnapshot[]; loading: boolean }) {
  const rates = [...(data ?? [])].sort((a, b) => a.ratio - b.ratio)
  const [expanded, setExpanded] = useState(false)
  const [hasOverflow, setHasOverflow] = useState(false)
  const chipBoxRef = useRef<HTMLDivElement>(null)

  // 监听 chip 容器尺寸变化，决定是否要显示"展开"按钮。
  // 收起状态下 scrollHeight > clientHeight 表示有内容被裁剪。
  useEffect(() => {
    const el = chipBoxRef.current
    if (!el) return
    const check = () => {
      if (expanded) return
      setHasOverflow(el.scrollHeight > el.clientHeight + 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rates.length, expanded])

  if (loading) return null
  if (rates.length === 0) return null

  const showToggle = hasOverflow || expanded

  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {rates.length} 个分组
        </p>
        {showToggle ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {expanded ? "收起" : "展开"}
            <ChevronDown
              className={cn(
                "size-3 transition-transform duration-200",
                expanded && "rotate-180",
              )}
            />
          </button>
        ) : null}
      </div>

      <div className="relative min-h-16">
        <div
          ref={chipBoxRef}
          className={cn(
            "flex flex-wrap gap-1 overflow-hidden transition-[max-height] duration-300 ease-out",
            // 收起：max-h-12 (~48px) 约 2 行；展开：足够大的上限，留点缓冲让 transition 不立即消失。
            expanded ? "max-h-150" : "max-h-12",
          )}
        >
          {rates.map((r) => (
            <Tooltip key={r.id} delayDuration={150}>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex cursor-default items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset transition-colors hover:bg-muted/60",
                    ratioTone(),
                  )}
                >
                  <span className="font-medium">{r.model_name}</span>
                  <span className="rounded bg-background px-1 font-semibold tabular-nums text-foreground ring-1 ring-inset ring-border">
                    {formatRatio(r.ratio)}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                <p className="font-medium">{r.model_name}</p>
                {r.description ? (
                  <p className="mt-0.5 text-muted-foreground">{r.description}</p>
                ) : (
                  <p className="mt-0.5 italic text-muted-foreground">{"(无描述)"}</p>
                )}
                <p className="mt-0.5 text-muted-foreground">
                  {"最近更新："}
                  {relativeTime(r.last_seen_at)}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        {/* 折叠时底部淡出，提示还有更多内容 */}
        {!expanded && hasOverflow ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-linear-to-t from-background to-transparent" />
        ) : null}
      </div>
    </div>
  )
}

function ChannelListGroups({
  rates: data,
  loading,
  emptyLabel = "暂无分组",
}: {
  rates?: RateSnapshot[]
  loading: boolean
  emptyLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const groupBoxClass = "flex h-[3.75rem] max-w-[360px] content-start flex-wrap items-start gap-1 overflow-hidden"
  const groups = useMemo(() => {
    const seen = new Set<string>()
    return (data ?? []).filter((rate) => {
      const name = rate.model_name.trim()
      if (!name || seen.has(name)) return false
      seen.add(name)
      return true
    })
  }, [data])

  if (loading && !data) {
    return (
      <div className={groupBoxClass}>
        <span className="text-[11px] text-muted-foreground">加载中…</span>
      </div>
    )
  }
  if (groups.length === 0) {
    return (
      <div className={groupBoxClass}>
        <span className="text-[11px] text-muted-foreground">{emptyLabel}</span>
      </div>
    )
  }

  const collapsedCount = 4
  const visible = expanded ? groups : groups.slice(0, collapsedCount)
  const hiddenCount = Math.max(0, groups.length - collapsedCount)
  const title = groups.map((rate) => `${rate.model_name} · ${formatRatio(rate.ratio)}`).join("\n")

  return (
    <div className={cn(groupBoxClass, expanded && "h-auto max-h-[12rem] overflow-y-auto")} title={expanded ? undefined : title}>
      {visible.map((rate) => (
        <span
          key={rate.id}
          className={cn(
            "inline-flex max-w-[132px] items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset",
            ratioTone(),
          )}
        >
          <span className="truncate font-medium">{rate.model_name}</span>
          <span className="shrink-0 font-medium tabular-nums text-foreground/70">{formatRatio(rate.ratio)}</span>
        </span>
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded bg-foreground/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-foreground ring-1 ring-inset ring-foreground/15 transition-colors hover:bg-foreground/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-label={expanded ? `收起 ${hiddenCount} 个分组` : `展开另外 ${hiddenCount} 个分组`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : `+${hiddenCount}`}
          <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
        </button>
      ) : null}
    </div>
  )
}

interface ChannelAPIKeyDialogState {
  channel: Channel
  initialAction?: ChannelAPIKeyInitialAction
}

interface ChannelSyncState {
  running: boolean
  events: ProgressEvent[]
  latest: ProgressEvent | null
  finalOk: boolean | null
  fading: boolean
}

function emptySyncState(): ChannelSyncState {
  return { running: false, events: [], latest: null, finalOk: null, fading: false }
}

interface BulkSyncState {
  running: boolean
  completed: number
  total: number
}

interface BatchRecoveryResult {
  id: number
  name: string
  ok: boolean
  error?: string
}

const stageLabel: Record<ProgressEvent["stage"], string> = {
  captcha: "打码",
  session: "会话",
  login: "登录",
  balance: "余额",
  cost: "消费",
  subscription: "订阅",
  rates: "倍率",
  done: "完成",
  error: "失败",
}

const stageOrder: Record<ProgressEvent["stage"], number> = {
  captcha: 1,
  session: 2,
  login: 3,
  balance: 4,
  cost: 5,
  subscription: 6,
  rates: 7,
  done: 9,
  error: 9,
}

/** 按 stage 去重，每个 stage 只留最后一条事件（"在做中→完成"会被覆盖成完成态）。 */
function deriveSteps(events: ProgressEvent[]): ProgressEvent[] {
  const byStage = new Map<ProgressEvent["stage"], ProgressEvent>()
  for (const ev of events) byStage.set(ev.stage, ev)
  return [...byStage.values()].sort((a, b) => stageOrder[a.stage] - stageOrder[b.stage])
}

function SyncProgressStrip({ state }: { state: ChannelSyncState }) {
  if (!state.running && state.latest == null) return null
  const steps = deriveSteps(state.events)

  return (
    <div
      className={cn(
        "mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5",
        // 入场：上方滑入 + 淡入
        "animate-in fade-in slide-in-from-top-1 duration-300",
        // 出场：和 scheduleHide 里的 500ms 对齐
        "transition-all duration-500 ease-out",
        state.fading ? "-translate-y-0.5 opacity-0" : "opacity-100",
      )}
    >
      {steps.length === 0 ? (
        <div className="flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          <span className="text-foreground/80">{"准备中…"}</span>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {steps.map((ev) => {
            // 终止态：stage=done 或 error；显式 ok=true / false 也算
            const failed = ev.stage === "error" || ev.ok === false
            const succeeded = ev.stage === "done" || ev.ok === true
            const running = !failed && !succeeded
            const Icon = running ? Loader2 : failed ? XCircle : CheckCircle2
            const tone = running ? "text-muted-foreground" : failed ? "text-danger" : "text-success"
            return (
              <li
                key={ev.stage}
                className="flex items-start gap-2 text-xs animate-in fade-in duration-200"
              >
                <Icon
                  className={cn("size-3.5 shrink-0", tone, running && "animate-spin")}
                />
                <span className="w-9 shrink-0 text-[11px] text-muted-foreground">
                  {stageLabel[ev.stage]}
                </span>
                <div className="min-w-0 flex-1 overflow-x-auto">
                  <span
                    className={cn(
                      "block whitespace-pre-wrap",
                      failed ? "text-danger" : running ? "text-foreground/80" : "text-foreground",
                    )}
                  >
                    {ev.message}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function ChannelCards({ favoriteOnly = false }: { favoriteOnly?: boolean }) {
  const navigate = useNavigate()
  const { data: channels, loading: channelsLoading } = useChannels()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<ChannelPageSize>("all")
  const pageQuery = useChannelsPage(page, pageSize === "all" ? -1 : pageSize)
  const refresh = useTriggerRefresh()
  const refreshTick = useRefreshTick()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [editing, setEditing] = useState<Channel | null>(null)
  const [creating, setCreating] = useState(false)
  const [preferCredentialMode, setPreferCredentialMode] = useState<CredentialMode | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [errorFilter, setErrorFilter] = useState<"all" | "failed" | ChannelErrorKind>(() => {
    if (typeof window === "undefined") return "all"
    try {
      const raw = window.localStorage.getItem("uh_channel_error_filter")
      if (!raw) return "all"
      if (raw === "all" || raw === "failed") return raw
      if (
        ["fingerprint", "token_expired", "turnstile", "bad_password", "network", "other"].includes(
          raw,
        )
      ) {
        return raw as ChannelErrorKind
      }
    } catch {
      /* ignore */
    }
    return "all"
  })
  const [compactCards, setCompactCards] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      return window.localStorage.getItem("uh_channel_compact") === "1"
    } catch {
      return false
    }
  })
  const [viewMode, setViewMode] = useState<ChannelViewMode>(() => {
    if (typeof window === "undefined") return "cards"
    try {
      return window.localStorage.getItem("uh_channel_view_mode") === "cards" ? "cards" : "list"
    } catch {
      return "cards"
    }
  })
  const [channelSort, setChannelSort] = useState<ChannelSortState>(null)
  const usageRange = useMemo(() => usageDateRange(7), [])
  const [usageSummary, setUsageSummary] = useState<UpstreamUsageResponse | null>(null)
  const [usageSummaryLoading, setUsageSummaryLoading] = useState(false)

  useEffect(() => {
    if (viewMode !== "list" || !channels?.length) return
    let cancelled = false
    const params = new URLSearchParams({
      start_date: usageRange.start,
      end_date: usageRange.end,
      cache_only: "true",
    })
    setUsageSummaryLoading(true)
    apiFetch<UpstreamUsageResponse>(`/channels/usage-analytics?${params}`)
      .then((response) => {
        if (!cancelled) setUsageSummary(response)
      })
      .catch(() => {
        if (!cancelled) setUsageSummary(null)
      })
      .finally(() => {
        if (!cancelled) setUsageSummaryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [channels?.length, refreshTick, usageRange.end, usageRange.start, viewMode])

  const usageByChannel = useMemo(
    () => new Map((usageSummary?.channels ?? []).map((item) => [item.channel_id, item])),
    [usageSummary?.channels],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem("uh_channel_error_filter", errorFilter)
    } catch {
      /* ignore */
    }
  }, [errorFilter])

  useEffect(() => {
    try {
      window.localStorage.setItem("uh_channel_compact", compactCards ? "1" : "0")
    } catch {
      /* ignore */
    }
  }, [compactCards])

  useEffect(() => {
    try {
      window.localStorage.setItem("uh_channel_view_mode", viewMode)
    } catch {
      /* ignore */
    }
  }, [viewMode])

  function openCreate() {
    setEditing(null)
    setPreferCredentialMode(null)
    setCreating(true)
  }

  function openEdit(channel: Channel, mode?: CredentialMode | null) {
    setEditing(channel)
    setPreferCredentialMode(mode ?? null)
    setCreating(true)
  }

  function toggleChannelSort(key: ChannelSortKey) {
    setChannelSort((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" }
      if (current.direction === "asc") return { key, direction: "desc" }
      return null
    })
  }

  const [redeeming, setRedeeming] = useState<Channel | null>(null)
  const [recharging, setRecharging] = useState<Channel | null>(null)
  const [apiKeyDialog, setAPIKeyDialog] = useState<ChannelAPIKeyDialogState | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [batchRecoveryRunning, setBatchRecoveryRunning] = useState(false)
  const [batchRecoveryResults, setBatchRecoveryResults] = useState<BatchRecoveryResult[] | null>(null)
  // 每个渠道当前 sync 进度（最新一条事件） + 历史事件
  const [syncState, setSyncState] = useState<Record<number, ChannelSyncState>>({})
  const [bulkSync, setBulkSync] = useState<BulkSyncState>({ running: false, completed: 0, total: 0 })
  const anySyncRunning =
    batchRecoveryRunning || bulkSync.running || Object.values(syncState).some((s) => s.running)
  const channelPage = pageQuery.data
  const allChannels = channels ?? []
  const failedChannels = useMemo(
    () => allChannels.filter((c) => Boolean(c.last_error)),
    [allChannels],
  )
  const fingerprintFailed = useMemo(
    () =>
      failedChannels.filter((c) => classifyChannelError(c.last_error).kind === "fingerprint"),
    [failedChannels],
  )
  const turnstileFailed = useMemo(
    () =>
      failedChannels.filter((c) => classifyChannelError(c.last_error).kind === "turnstile"),
    [failedChannels],
  )
  const filteredByError = useMemo(() => {
    if (errorFilter === "all") return null
    if (errorFilter === "failed") return failedChannels
    return failedChannels.filter((c) => classifyChannelError(c.last_error).kind === errorFilter)
  }, [errorFilter, failedChannels])
  const favoriteChannels = useMemo(
    () => allChannels.filter((channel) => channel.favorite),
    [allChannels],
  )
  const filteredChannels = useMemo(() => {
    if (!favoriteOnly) return filteredByError
    if (errorFilter === "all") return favoriteChannels
    if (errorFilter === "failed") return favoriteChannels.filter((channel) => channel.last_error)
    return favoriteChannels.filter(
      (channel) =>
        channel.last_error && classifyChannelError(channel.last_error).kind === errorFilter,
    )
  }, [errorFilter, favoriteChannels, favoriteOnly, filteredByError])
  const filterActive = favoriteOnly || filteredChannels != null
  const failFirst = errorFilter === "all"
  const visibleChannels = useMemo(() => {
    const base = filterActive
      ? (filteredChannels as Channel[])
      : (channelPage?.items ?? [])
    if (!failFirst || filterActive || channelSort) return base
    // When showing paged "all", still surface failed channels first within the page.
    return [...base].sort((a, b) => {
      const af = a.last_error ? 0 : 1
      const bf = b.last_error ? 0 : 1
      if (af !== bf) return af - bf
      return (b.sort_order ?? 0) - (a.sort_order ?? 0)
    })
  }, [channelSort, filterActive, filteredChannels, channelPage?.items, failFirst])
  const totalChannels = filterActive
    ? filteredChannels!.length
    : (channelPage?.total ?? 0)
  const pageSizeAll = pageSize === "all" || filterActive
  const totalPages = pageSizeAll ? 1 : (channelPage?.pages ?? 1)
  const currentPage = pageSizeAll ? 1 : Math.min(page, totalPages)
  const effectivePageSize = pageSizeAll ? Math.max(totalChannels, 1) : pageSize
  const rangeStart = totalChannels === 0 ? 0 : (currentPage - 1) * effectivePageSize + 1
  const rangeEnd = Math.min((currentPage - 1) * effectivePageSize + visibleChannels.length, totalChannels)
  const rateSummaries = useChannelRateSummaries(visibleChannels.map((channel) => channel.id))
  const ratesByChannel = useMemo(() => {
    const result = new Map<number, RateSnapshot[]>()
    for (const rate of rateSummaries.data ?? []) {
      const rates = result.get(rate.channel_id) ?? []
      rates.push(rate)
      result.set(rate.channel_id, rates)
    }
    return result
  }, [rateSummaries.data])
  const sortedChannels = useMemo(() => {
    if (!channelSort) return visibleChannels
    return [...visibleChannels].sort((a, b) => {
      const result = compareChannelSortValues(
        channelSortValue(a, channelSort.key, usageByChannel),
        channelSortValue(b, channelSort.key, usageByChannel),
        channelSort.direction,
      )
      return result || (b.sort_order ?? 0) - (a.sort_order ?? 0)
    })
  }, [channelSort, usageByChannel, visibleChannels])
  const pagerNumbers = pageNumbers(currentPage, totalPages)

  // 成功后自动消失需要的两段定时器：先 5s 显示，再 500ms 过渡（与 strip 的 transition-opacity duration-500 对齐）。
  const hideTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const timers = hideTimers.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages))
  }, [totalPages])

  function clearHideTimer(id: number) {
    const t = hideTimers.current.get(id)
    if (t != null) {
      clearTimeout(t)
      hideTimers.current.delete(id)
    }
  }

  function scheduleHide(id: number) {
    clearHideTimer(id)
    const t1 = setTimeout(() => {
      patchSync(id, (prev) => ({ ...prev, fading: true }))
      const t2 = setTimeout(() => {
        setSyncState((s) => {
          const { [id]: _gone, ...rest } = s
          void _gone
          return rest
        })
        hideTimers.current.delete(id)
      }, 500)
      hideTimers.current.set(id, t2)
    }, 5000)
    hideTimers.current.set(id, t1)
  }

  function patchSync(id: number, fn: (prev: ChannelSyncState) => ChannelSyncState) {
    setSyncState((s) => ({ ...s, [id]: fn(s[id] ?? emptySyncState()) }))
  }

  async function startStream(channel: Channel, action: "sync" | "test-login") {
    clearHideTimer(channel.id)
    patchSync(channel.id, () => ({
      running: true,
      events: [],
      latest: null,
      finalOk: null,
      fading: false,
    }))
    let sawError = false
    const stream = action === "sync" ? syncChannelStream : testLoginStream
    try {
      await stream(channel.id, {
        onEvent: (ev) => {
          if (ev.stage === "error" || ev.ok === false) sawError = true
          patchSync(channel.id, (prev) => ({
            ...prev,
            events: [...prev.events, ev],
            latest: ev,
          }))
        },
      })
      const ok = !sawError
      patchSync(channel.id, (prev) => ({
        ...prev,
        running: false,
        finalOk: ok,
      }))
      if (ok) scheduleHide(channel.id)
    } catch (e) {
      const err = e as Error
      const failureLabel = action === "sync" ? "同步失败" : "测试登录失败"
      patchSync(channel.id, (prev) => ({
        ...prev,
        running: false,
        finalOk: false,
        latest: {
          stage: "error",
          message: err.message || failureLabel,
          time: new Date().toISOString(),
        },
      }))
      // 失败保留，不调度自动隐藏
    } finally {
      refresh()
    }
  }

  async function startBulkSync(onlyFailed = false) {
    const list = onlyFailed
      ? (errorFilter !== "all" && filteredByError
          ? filteredByError
          : failedChannels)
      : (channels ?? [])
    if (list.length === 0) {
      toast.message(onlyFailed ? "没有失败渠道可同步" : "没有渠道可同步")
      return
    }

    // 全量：走后端 sync-all；仅失败：逐渠道串行同步，避免无筛选 API
    if (!onlyFailed) {
      for (const channel of list) {
        clearHideTimer(channel.id)
        patchSync(channel.id, () => ({
          running: true,
          events: [],
          latest: null,
          finalOk: null,
          fading: false,
        }))
      }

      setBulkSync({ running: true, completed: 0, total: list.length })
      try {
        await syncAllChannelsStream({
          onEvent: (ev) => {
            if (ev.channel_id != null) {
              patchSync(ev.channel_id, (prev) => ({
                ...prev,
                events: [...prev.events, ev],
                latest: ev,
                running: ev.stage !== "done" && ev.stage !== "error",
                finalOk: ev.stage === "done" ? true : ev.stage === "error" ? false : prev.finalOk,
                fading: false,
              }))
              if (ev.stage === "done") {
                scheduleHide(ev.channel_id)
              }
            }

            if (ev.index != null && ev.total != null) {
              setBulkSync((prev) => ({
                ...prev,
                completed: Math.max(prev.completed, ev.index ?? prev.completed),
                total: ev.total ?? prev.total,
              }))
            }

            if (ev.channel_id == null && (ev.stage === "done" || ev.stage === "error")) {
              if (ev.stage === "done") {
                toast.success(ev.message)
              } else {
                toast.error(ev.message)
              }
            }
          },
        })
      } catch (e) {
        const err = e as Error
        toast.error(err.message || "批量同步失败")
      } finally {
        setSyncState((s) => {
          const next: Record<number, ChannelSyncState> = {}
          for (const [id, state] of Object.entries(s)) {
            next[Number(id)] = { ...state, running: false }
          }
          return next
        })
        setBulkSync((prev) => ({ ...prev, running: false }))
        refresh()
      }
      return
    }

    setBulkSync({ running: true, completed: 0, total: list.length })
    let okN = 0
    let failN = 0
    for (let i = 0; i < list.length; i++) {
      const channel = list[i]
      clearHideTimer(channel.id)
      patchSync(channel.id, () => ({
        running: true,
        events: [],
        latest: null,
        finalOk: null,
        fading: false,
      }))
      let sawError = false
      try {
        await syncChannelStream(channel.id, {
          onEvent: (ev) => {
            if (ev.stage === "error" || ev.ok === false) sawError = true
            patchSync(channel.id, (prev) => ({
              ...prev,
              events: [...prev.events, ev],
              latest: ev,
            }))
          },
        })
        const ok = !sawError
        if (ok) okN += 1
        else failN += 1
        patchSync(channel.id, (prev) => ({
          ...prev,
          running: false,
          finalOk: ok,
        }))
        if (ok) scheduleHide(channel.id)
      } catch (e) {
        failN += 1
        const err = e as Error
        patchSync(channel.id, (prev) => ({
          ...prev,
          running: false,
          finalOk: false,
          latest: {
            stage: "error",
            message: err.message || "同步失败",
            time: new Date().toISOString(),
          },
        }))
      }
      setBulkSync((prev) => ({ ...prev, completed: i + 1, total: list.length }))
    }
    setBulkSync((prev) => ({ ...prev, running: false }))
    toast.message(`失败项同步完成：成功 ${okN}，失败 ${failN}`)
    refresh()
    // 仍有失败则保持/切到失败筛选，方便继续处理
    if (failN > 0) {
      setErrorFilter((prev) => (prev === "all" ? "failed" : prev))
      setPage(1)
    } else if (okN > 0) {
      setErrorFilter("all")
    }
  }

  async function batchSetPasswordMode() {
    const targets =
      errorFilter === "fingerprint"
        ? fingerprintFailed
        : failedChannels.filter((c) => {
            const k = classifyChannelError(c.last_error).kind
            return k === "fingerprint" || k === "token_expired" || k === "bad_password"
          })
    if (targets.length === 0) {
      toast.message("当前没有适合改密码模式的失败渠道")
      return
    }
    const email = window.prompt(
      `将为 ${targets.length} 个失败渠道切换到「账号密码」模式。\n请输入登录邮箱/用户名（可留空则保留原 username）：`,
      targets[0]?.username || "",
    )
    if (email === null) return
    const password = window.prompt("请输入密码（将写入所选渠道，请确认环境可信）：")
    if (password === null || !password.trim()) {
      toast.error("未填写密码，已取消")
      return
    }
    const ok = await confirm({
      title: `确认批量改密码模式？`,
      description: `将更新 ${targets.length} 个渠道的 credential_mode=password。密码仅发往本机 API。`,
      confirmLabel: "确认写入",
      destructive: true,
    })
    if (!ok) return

    let okN = 0
    let failN = 0
    setBatchRecoveryRunning(true)
    setBatchRecoveryResults([])
    try {
      for (const ch of targets) {
        try {
          await apiFetch(`/channels/${ch.id}`, {
            method: "PUT",
            body: JSON.stringify({
              credential_mode: "password",
              username: email.trim() || ch.username,
              password: password.trim(),
              turnstile_enabled: ch.turnstile_enabled,
            }),
          })
          okN += 1
          setBatchRecoveryResults((prev) => [
            ...(prev ?? []),
            { id: ch.id, name: ch.name, ok: true },
          ])
        } catch (e) {
          failN += 1
          setBatchRecoveryResults((prev) => [
            ...(prev ?? []),
            {
              id: ch.id,
              name: ch.name,
              ok: false,
              error: e instanceof Error ? e.message : "淇澶辫触",
            },
          ])
        }
      }
    } finally {
      setBatchRecoveryRunning(false)
    }
    toast.message(`批量改密码完成：成功 ${okN}，失败 ${failN}`)
    setErrorFilter("failed")
    refresh()
  }

  async function setFavorite(channel: Channel) {
    const favorite = !channel.favorite
    await withBusy(`favorite-${channel.id}`, async () => {
      await apiFetch<Channel>(`/channels/${channel.id}/favorite`, {
        method: "PUT",
        body: JSON.stringify({ favorite }),
      })
      toast.success(favorite ? `已收藏 ${channel.name}` : `已取消收藏 ${channel.name}`)
    })
  }

  async function withBusy(key: string, fn: () => Promise<unknown>) {
    setBusyAction(key)
    try {
      await fn()
      refresh()
    } catch (e) {
      const err = e as Error
      toast.error(err.message || "操作失败")
    } finally {
      setBusyAction(null)
    }
  }

  function renderRedeemSummary(result: ChannelRedeemResult) {
    if (result.type === "subscription") {
      const group = result.group_name ? ` · ${result.group_name}` : ""
      const days = result.validity_days ? ` · ${result.validity_days} 天` : ""
      return `${result.message || "兑换成功"}${group}${days}`
    }
    if (result.type === "concurrency") {
      const extra = result.new_concurrency != null ? ` · 当前并发 ${result.new_concurrency}` : ""
      return `${result.message || "兑换成功"}${extra}`
    }
    const extra = result.new_balance != null ? ` · 当前余额 ${money(result.new_balance)}` : ""
    return `${result.message || "兑换成功"}${extra}`
  }

  return (
    <section>
      {batchRecoveryResults ? (
        <div className="mb-3 rounded-md border border-border bg-muted/20 p-2.5 text-xs">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-medium">Batch recovery results</span>
            <span className="text-muted-foreground">
              {batchRecoveryResults.filter((item) => item.ok).length}/{batchRecoveryResults.length}
            </span>
          </div>
          <ul className="max-h-32 space-y-0.5 overflow-y-auto">
            {batchRecoveryResults.map((item) => (
              <li key={item.id} className={cn(item.ok ? "text-success" : "text-danger")}>
                {item.ok ? "✓" : "×"} {item.name}
                {item.error ? ` - ${item.error}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
          <div
            className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5"
            role="group"
            aria-label="渠道范围"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 rounded-md px-2.5 text-xs",
                !favoriteOnly && "bg-background text-foreground shadow-sm",
              )}
              onClick={() => navigate("/ops/channels")}
            >
              全部
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 gap-1 rounded-md px-2.5 text-xs",
                favoriteOnly && "bg-background text-foreground shadow-sm",
              )}
              onClick={() => navigate("/ops/channels?scope=favorites")}
            >
              <Star className={cn("size-3", favoriteOnly && "fill-amber-400 text-amber-500")} />
              收藏 {favoriteChannels.length}
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            {filterActive
              ? `筛选 ${totalChannels} / 全部 ${allChannels.length}`
              : `${totalChannels} 个渠道`}
            {failedChannels.length > 0 ? ` · 失败 ${failedChannels.length}` : ""}
            {errorFilter === "all" ? " · 失败优先" : ""}
          </span>
          <div
            className="inline-flex h-8 items-center rounded-lg border border-border bg-muted/40 p-0.5"
            role="group"
            aria-label="渠道视图"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 gap-1 rounded-md px-2 text-xs",
                viewMode === "cards" && "bg-background text-foreground shadow-sm",
              )}
              aria-label="卡片"
              aria-pressed={viewMode === "cards"}
              onClick={() => setViewMode("cards")}
              title="卡片视图"
            >
              <Grid2X2 className="size-3.5" />
              <span className="hidden 2xl:inline">卡片</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 gap-1 rounded-md px-2 text-xs",
                viewMode === "list" && "bg-background text-foreground shadow-sm",
              )}
              aria-label="列表"
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
              title="列表视图"
            >
              <List className="size-3.5" />
              <span className="hidden 2xl:inline">列表</span>
            </Button>
          </div>
          {viewMode === "cards" ? (
            <Button
              variant={compactCards ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() => setCompactCards((v) => !v)}
              title="切换卡片密度"
            >
              {compactCards ? "紧凑" : "舒适"}
            </Button>
          ) : null}
          <Select
            value={errorFilter}
            onValueChange={(v) => {
              setErrorFilter(v as typeof errorFilter)
              setPage(1)
            }}
          >
            <SelectTrigger className="h-8 w-[128px] text-xs">
              <SelectValue placeholder="状态筛选" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">全部渠道</SelectItem>
              {CHANNEL_ERROR_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            disabled={anySyncRunning}
            onClick={() => void startBulkSync(false)}
          >
            <RefreshCw className={cn("size-3.5", bulkSync.running && "animate-spin")} />
            {bulkSync.running ? `同步中 ${bulkSync.completed}/${bulkSync.total}` : "同步全部"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            disabled={anySyncRunning || failedChannels.length === 0}
            onClick={() => void startBulkSync(true)}
          >
            <RefreshCw className={cn("size-3.5", bulkSync.running && "animate-spin")} />
            {"同步失败"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            disabled={
              anySyncRunning ||
              (fingerprintFailed.length === 0 &&
                failedChannels.filter((c) => {
                  const k = classifyChannelError(c.last_error).kind
                  return k === "token_expired" || k === "bad_password"
                }).length === 0)
            }
            onClick={() => void batchSetPasswordMode()}
          >
            <KeyRound className="size-3.5" />
            {"批量改密"}
          </Button>
          {turnstileFailed.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => navigate("/captcha")}
            >
              {"打码配置"}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setImportOpen(true)}
          >
            <FileUp className="size-3.5" />
            {"导入"}
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={openCreate}
          >
            <Plus className="size-3.5" />
            {"新增"}
          </Button>
      </div>

      {(pageQuery.loading && !channelPage) || (favoriteOnly && channelsLoading && !channels) ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {"加载中…"}
        </p>
      ) : totalChannels === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">
            {favoriteOnly
              ? errorFilter === "all"
                ? "还没有收藏渠道"
                : "没有符合当前状态筛选的收藏渠道"
              : "还没有任何渠道"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {favoriteOnly
              ? "点渠道卡片右上角的星星，把重点渠道收藏到这里。"
              : "可手动新增，或从 all-api-hub 备份 JSON 一键导入。"}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {favoriteOnly ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate("/ops/channels")}>
                查看全部渠道
              </Button>
            ) : (
              <>
                <Button size="sm" className="gap-1.5" onClick={openCreate}>
                  <Plus className="size-3.5" />
                  {"添加第一个渠道"}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportOpen(true)}>
                  <FileUp className="size-3.5" />
                  {"导入备份"}
                </Button>
                <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={() => navigate("/settings")}>
                  {"查看设置 / 备份说明"}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          {viewMode === "list" ? (
            <Card className="border border-border p-0 shadow-none">
              <Table data-testid="channel-list-table" className="min-w-[1560px] table-fixed">
                <colgroup>
                  <col className="w-[3%]" />
                  <col className="w-[17%]" />
                  <col className="w-[10%]" />
                  <col className="w-[17%]" />
                  <col className="w-[8%]" />
                  <col className="w-[11%]" />
                  <col className="w-[8%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <TableHeader className="bg-muted/45 text-[11px] text-muted-foreground [&_th]:px-3">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-10 w-11"><span className="sr-only">收藏</span></TableHead>
                    <TableHead className="h-10 font-semibold">渠道</TableHead>
                    <TableHead className="h-10 bg-muted/35 text-center font-semibold">状态</TableHead>
                    <TableHead className="h-10 bg-muted/35 font-semibold">分组</TableHead>
                    <SortableChannelHead
                      sortKey="balance"
                      label="余额"
                      sortState={channelSort}
                      onSort={toggleChannelSort}
                      className="bg-brand/5 text-center font-semibold"
                    >
                      余额
                    </SortableChannelHead>
                    <SortableChannelHead
                      sortKey="actualPrice"
                      label="实际单价"
                      sortState={channelSort}
                      onSort={toggleChannelSort}
                      className="bg-brand/5 text-center font-semibold leading-tight"
                    >
                      <span className="leading-tight">
                        <span className="block">实际单价</span>
                        <span className="font-normal opacity-70">$/百万 · $/次</span>
                      </span>
                    </SortableChannelHead>
                    <SortableChannelHead
                      sortKey="usage"
                      label="7 日用量"
                      sortState={channelSort}
                      onSort={toggleChannelSort}
                      className="text-center font-medium text-muted-foreground leading-tight"
                    >
                      <span className="leading-tight">
                        <span className="block">7 日用量</span>
                        <span className="font-normal opacity-70">Token / 请求</span>
                      </span>
                    </SortableChannelHead>
                    <SortableChannelHead
                      sortKey="latency"
                      label="平均耗时"
                      sortState={channelSort}
                      onSort={toggleChannelSort}
                      className="text-center font-medium text-muted-foreground"
                    >
                      平均耗时
                    </SortableChannelHead>
                    <SortableChannelHead
                      sortKey="todayCost"
                      label="今日消费"
                      sortState={channelSort}
                      onSort={toggleChannelSort}
                      className="text-center font-medium text-muted-foreground"
                    >
                      今日消费
                    </SortableChannelHead>
                    <TableHead className="h-10 font-medium text-muted-foreground">最近更新</TableHead>
                    <TableHead className="sticky right-0 z-20 border-l border-border bg-muted text-center">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedChannels.map((c) => {
                    const status = statusOf(c)
                    const meta = statusMap[status]
                    const statusLabel = status === "failed" ? failedStatusLabel(c) : meta.label
                    const errInfo = classifyChannelError(c.last_error)
                    const extra = parseChannelExtra(c.login_extra_params)
                    const channelSync = syncState[c.id]
                    const usage = usageByChannel.get(c.id)
                    const usageMetrics = usage && hasUsagePriceSample(usage.totals) ? usageUnitMetrics(usage.totals) : null
                    const hasDurationSample = usage != null && hasUsageDurationSample(usage.totals)
                    return (
                      <TableRow
                        key={c.id}
                        className="group hover:bg-muted/45"
                      >
                        <TableCell className="px-3">
                          <Tooltip delayDuration={150}>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className={cn(
                                  "size-7 text-muted-foreground hover:text-amber-500",
                                  c.favorite && "text-amber-500",
                                )}
                                disabled={busyAction === `favorite-${c.id}`}
                                aria-label={c.favorite ? `取消收藏 ${c.name}` : `收藏 ${c.name}`}
                                aria-pressed={c.favorite}
                                onClick={() => void setFavorite(c)}
                              >
                                {busyAction === `favorite-${c.id}` ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Star className={cn("size-3.5", c.favorite && "fill-amber-400")} />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              {c.favorite ? "取消收藏" : "收藏渠道"}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span
                                  className="inline-flex shrink-0 items-center rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-border"
                                >
                                  {channelTypeLabel(c.type)}
                                </span>
                                {extra.source ? (
                                  <span className="max-w-24 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-inset ring-border" title={extra.source}>
                                    {extra.source}
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1 flex min-w-0 items-center gap-1">
                                <a
                                  href={c.site_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="max-w-[220px] truncate font-semibold text-foreground hover:text-brand hover:underline"
                                  title={c.name}
                                >
                                  {c.name}
                                </a>
                                <Button
                                  asChild
                                  variant="ghost"
                                  size="icon-sm"
                                  className="size-5 shrink-0 text-muted-foreground opacity-60 hover:text-foreground group-hover:opacity-100"
                                >
                                  <a href={c.site_url} target="_blank" rel="noopener noreferrer" aria-label={`新窗口打开 ${c.name} 站点地址`}>
                                    <ExternalLink className="size-3.5" />
                                  </a>
                                </Button>
                              </div>
                              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                                {extra.tagIds.slice(0, 2).map((tag) => (
                                  <span key={tag} className="max-w-20 truncate rounded bg-muted/60 px-1.5 py-0.5 text-muted-foreground ring-1 ring-inset ring-border" title={tag}>
                                    {tag}
                                  </span>
                                ))}
                                {extra.notesPreview ? (
                                  <span className="max-w-36 truncate" title={extra.notesPreview}>{extra.notesPreview}</span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="overflow-hidden px-2 py-2 text-center">
                          <div className="mx-auto flex min-w-0 max-w-40 flex-col items-center gap-1">
                            <div className="flex flex-wrap items-center justify-center gap-1">
                              {channelSync?.running ? <Loader2 className="size-3.5 animate-spin text-brand" /> : null}
                              <span className={cn("inline-flex min-w-16 items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset", meta.cls)}>
                                {statusLabel}
                              </span>
                              {!c.monitor_enabled ? (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
                                  已暂停
                                </span>
                              ) : null}
                            </div>
                          {c.last_error ? (
                            <Tooltip delayDuration={150}>
                              <TooltipTrigger asChild>
                                <p className="max-w-full truncate text-[10px] leading-4 text-danger/80">
                                  {errInfo.hint || c.last_error}
                                </p>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-sm whitespace-pre-wrap text-xs">
                                {c.last_error}
                              </TooltipContent>
                            </Tooltip>
                          ) : channelSync?.latest?.message ? (
                            <p className="max-w-full truncate text-[10px] leading-4 text-muted-foreground" title={channelSync.latest.message}>
                              {channelSync.latest.message}
                            </p>
                          ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="overflow-hidden bg-muted/10 py-2 align-middle">
                          <ChannelListGroups
                            rates={ratesByChannel.get(c.id)}
                            loading={rateSummaries.loading}
                            emptyLabel={c.last_error ? "未采集倍率" : undefined}
                          />
                        </TableCell>
                        <TableCell className="bg-brand/5 py-2 text-center font-semibold tabular-nums">
                          <Tooltip delayDuration={150}>
                            <TooltipTrigger asChild><span>{money(c.last_balance)}</span></TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">{rechargeMultiplierTip(c)}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="bg-brand/5 py-2 text-center font-semibold tabular-nums">
                          {usageMetrics ? (
                            <>
                              <div className="font-semibold text-foreground">{money(usageMetrics.actualPerMillion, { precise: true })}</div>
                              <div className="mt-0.5 text-[10px] text-muted-foreground">{money(usageMetrics.actualPerRequest, { precise: true })} / 次</div>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{usageSummaryLoading ? "…" : "—"}</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-center tabular-nums">
                          {usage ? (
                            <>
                              <div className="font-medium text-foreground">{formatTokens(usage.totals.total_tokens)}</div>
                              <div className="mt-0.5 text-[10px] text-muted-foreground">{usage.totals.requests.toLocaleString("zh-CN")} 次</div>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{usageSummaryLoading ? "…" : "—"}</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-center font-medium tabular-nums">
                          {hasDurationSample ? formatDurationMS(usage.totals.average_duration_ms) : usage ? "—" : usageSummaryLoading ? "…" : "—"}
                        </TableCell>
                        <TableCell className="py-2 text-center tabular-nums">
                          <div className="font-medium text-foreground">{money(c.today_cost)}</div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">累计 {money(c.total_cost)}</div>
                        </TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground">
                          {relativeTime(c.last_balance_at ?? c.updated_at)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "sticky right-0 z-10 border-l border-border px-3",
                            "bg-background group-hover:bg-muted",
                          )}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <Tooltip delayDuration={150}>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon-sm"
                                  className="size-7"
                                  aria-label={`同步 ${c.name}`}
                                  disabled={!!channelSync?.running || anySyncRunning}
                                  onClick={() => startStream(c, "sync")}
                                >
                                  <RefreshCw className={cn("size-3.5", channelSync?.running && "animate-spin")} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">同步渠道</TooltipContent>
                            </Tooltip>
                            <Tooltip delayDuration={150}>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon-sm"
                                  className="size-7"
                                  aria-label={`测试 ${c.name}`}
                                  disabled={!!channelSync?.running || anySyncRunning}
                                  onClick={() => startStream(c, "test-login")}
                                >
                                  <LogIn className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">测试登录</TooltipContent>
                            </Tooltip>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="size-7"
                              aria-label={`编辑 ${c.name}`}
                              onClick={() => openEdit(c)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="size-7"
                                  aria-label={`${c.name} 更多操作`}
                                  disabled={busyAction === `clear-login-${c.id}` || busyAction === `delete-${c.id}`}
                                >
                                  <MoreHorizontal className="size-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onSelect={() => setRecharging(c)}>
                                  <CreditCard className="size-3.5" />充值
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setRedeeming(c)}>
                                  <Gift className="size-3.5" />兑换
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setAPIKeyDialog({ channel: c })}>
                                  <KeyRound className="size-3.5" />密钥
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  disabled={busyAction === `toggle-${c.id}`}
                                  onSelect={(e) => {
                                    e.preventDefault()
                                    void withBusy(`toggle-${c.id}`, () =>
                                      apiFetch(`/channels/${c.id}/${c.monitor_enabled ? "disable" : "enable"}`, { method: "POST" }),
                                    )
                                  }}
                                >
                                  {c.monitor_enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                                  {c.monitor_enabled ? "暂停监控" : "恢复监控"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={busyAction === `clear-login-${c.id}`}
                                  onSelect={async (e) => {
                                    e.preventDefault()
                                    const ok = await confirm({
                                      title: `清空 ${c.name} 的登录信息？`,
                                      description: "将清空缓存会话；Token 模式还会清空已保存的 Access Token、Refresh Token 和 NewAPI Cookie。账号密码本身不会删除。",
                                      confirmLabel: "清空",
                                      destructive: true,
                                    })
                                    if (!ok) return
                                    void withBusy(`clear-login-${c.id}`, async () => {
                                      await apiFetch(`/channels/${c.id}/clear-login-info`, { method: "POST" })
                                      toast.success("已清空登录信息")
                                    })
                                  }}
                                >
                                  <XCircle className="size-3.5" />清空登录信息
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={busyAction === `delete-${c.id}`}
                                  onSelect={async (e) => {
                                    e.preventDefault()
                                    const ok = await confirm({
                                      title: `删除渠道 ${c.name}？`,
                                      description: "删除后该渠道的余额历史、倍率快照与登录凭据都将一并清除，且无法恢复。",
                                      confirmLabel: "删除",
                                      destructive: true,
                                    })
                                    if (!ok) return
                                    void withBusy(`delete-${c.id}`, () => apiFetch(`/channels/${c.id}`, { method: "DELETE" }))
                                  }}
                                >
                                  <Trash2 className="size-3.5" />删除
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Card>
          ) : (
          <div
            className={cn(
              "grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3",
              compactCards && "gap-2",
            )}
          >
            {visibleChannels.map((c) => {
              const status = statusOf(c)
              const meta = statusMap[status]
              const errInfo = classifyChannelError(c.last_error)
              const statusLabel = status === "failed" ? failedStatusLabel(c) : meta.label
              const extra = parseChannelExtra(c.login_extra_params)
              return (
                <Card
                  key={c.id}
                  className={cn(
                    "flex flex-col gap-0 border border-border shadow-none",
                    compactCards ? "p-2.5 sm:p-3" : "p-3 sm:p-4",
                    c.last_error && "border-danger/30",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{c.name}</span>
                      <span
                        className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-border"
                      >
                        {channelTypeLabel(c.type)}
                      </span>
                      {!c.monitor_enabled ? (
                        <span className="inline-flex items-center rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning ring-1 ring-inset ring-warning/20">
                          {"已暂停"}
                        </span>
                      ) : null}
                      {extra.source ? (
                        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-inset ring-border">
                          {extra.source}
                        </span>
                      ) : null}
                      {extra.tagIds.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex max-w-[6rem] truncate items-center rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-inset ring-border"
                          title={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Tooltip delayDuration={150}>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className={cn(
                              "size-7 text-muted-foreground hover:text-amber-500",
                              c.favorite && "text-amber-500",
                            )}
                            disabled={busyAction === `favorite-${c.id}`}
                            aria-label={c.favorite ? `取消收藏 ${c.name}` : `收藏 ${c.name}`}
                            aria-pressed={c.favorite}
                            onClick={() => void setFavorite(c)}
                          >
                            {busyAction === `favorite-${c.id}` ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Star className={cn("size-3.5", c.favorite && "fill-amber-400")} />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          {c.favorite ? "取消收藏" : "收藏渠道"}
                        </TooltipContent>
                      </Tooltip>
                      <div className="text-right text-[10px] leading-4 text-muted-foreground">
                        <p>{relativeTime(c.last_balance_at ?? c.updated_at)}</p>
                      </div>
                      <Tooltip delayDuration={150}>
                        <TooltipTrigger asChild>
                          <Button
                            asChild
                            variant="ghost"
                            size="icon-sm"
                            className="size-7 text-muted-foreground hover:text-foreground"
                          >
                            <a
                              href={c.site_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`新窗口打开 ${c.name} 站点地址`}
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          {"新窗口打开站点地址"}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  {extra.notesPreview ? (
                    <p
                      className="mt-1.5 truncate text-[11px] text-muted-foreground"
                      title={extra.notesPreview}
                    >
                      {extra.notesPreview}
                    </p>
                  ) : null}

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <StatTile label="余额">
                      <Tooltip delayDuration={150}>
                        <TooltipTrigger asChild>
                          <span className="block truncate">{money(c.last_balance)}</span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          {rechargeMultiplierTip(c)}
                        </TooltipContent>
                      </Tooltip>
                    </StatTile>
                    <StatTile label="今日消费">{money(c.today_cost)}</StatTile>
                    <StatTile label="累计消费">{money(c.total_cost)}</StatTile>
                    <StatTile label="阈值 / 状态">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Tooltip delayDuration={150}>
                          <TooltipTrigger asChild>
                            <span className="truncate text-[11px] font-medium text-foreground">
                              {c.balance_threshold > 0 ? money(c.balance_threshold) : "未设置"}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            {c.balance_threshold > 0
                              ? `余额低于 ${money(c.balance_threshold)} 时通知`
                              : "未开启低余额通知"}
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-[10px] text-muted-foreground">/</span>
                        <span className={cn("inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset", meta.cls)}>
                          {statusLabel}
                        </span>
                      </div>
                    </StatTile>
                    <ChannelSubscriptionUsageMetricTiles channel={c} />
                    {c.last_error ? (
                      <div className="col-span-3 space-y-1.5 rounded-md border border-border bg-muted/20 px-2.5 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center rounded bg-transparent px-1.5 py-0.5 text-[10px] font-medium text-danger ring-1 ring-inset ring-danger/30">
                            {errInfo.label || "登录失败"}
                          </span>
                          {errInfo.hint ? (
                            <span className="text-[11px] leading-4 text-danger/90">{errInfo.hint}</span>
                          ) : null}
                        </div>
                        <p
                          className="max-h-12 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-[10px] leading-4 text-muted-foreground"
                          title={c.last_error}
                        >
                          {c.last_error}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {errInfo.suggestPasswordMode ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-[11px]"
                              onClick={() => openEdit(c, "password")}
                            >
                              <KeyRound className="size-3" />
                              {"改用密码登录"}
                            </Button>
                          ) : null}
                          {errInfo.suggestRepasteToken ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-[11px]"
                              onClick={() => openEdit(c, "token")}
                            >
                              <Pencil className="size-3" />
                              {"重贴 Token"}
                            </Button>
                          ) : null}
                          {errInfo.suggestCaptcha ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-[11px]"
                              onClick={() => navigate("/captcha")}
                            >
                              {"配置打码"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <InlineRates rates={ratesByChannel.get(c.id)} loading={rateSummaries.loading} />

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      disabled={!!syncState[c.id]?.running || anySyncRunning}
                      onClick={() => startStream(c, "sync")}
                    >
                      <RefreshCw
                        className={cn("size-3", syncState[c.id]?.running && "animate-spin")}
                      />
                      {"同步"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      disabled={!!syncState[c.id]?.running || anySyncRunning}
                      onClick={() => startStream(c, "test-login")}
                      >
                        <LogIn className="size-3" />
                        {"测试登录"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => setRecharging(c)}
                    >
                      <CreditCard className="size-3" />
                      {"充值"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => setRedeeming(c)}
                    >
                      <Gift className="size-3" />
                      {"兑换"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => setAPIKeyDialog({ channel: c })}
                    >
                      <KeyRound className="size-3" />
                      {"密钥"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => openEdit(c)}
                    >
                      <Pencil className="size-3" />
                      {"编辑"}
                    </Button>
                  </div>

                  <SyncProgressStrip state={syncState[c.id] ?? emptySyncState()} />

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-xs text-muted-foreground"
                      disabled={busyAction === `toggle-${c.id}`}
                      onClick={() =>
                        withBusy(`toggle-${c.id}`, () =>
                          apiFetch(`/channels/${c.id}/${c.monitor_enabled ? "disable" : "enable"}`, {
                            method: "POST",
                          }),
                        )
                      }
                    >
                      {c.monitor_enabled ? (
                        <Pause className="size-3" />
                      ) : (
                        <Play className="size-3" />
                      )}
                      {c.monitor_enabled ? "暂停监控" : "恢复监控"}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs text-muted-foreground"
                          disabled={busyAction === `clear-login-${c.id}` || busyAction === `delete-${c.id}`}
                        >
                          <MoreHorizontal className="size-3" />
                          {"更多"}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem
                          disabled={busyAction === `clear-login-${c.id}`}
                          onSelect={async (e) => {
                            e.preventDefault()
                            const ok = await confirm({
                              title: `清空 ${c.name} 的登录信息？`,
                              description: "将清空缓存会话；Token 模式还会清空已保存的 Access Token、Refresh Token 和 NewAPI Cookie。账号密码本身不会删除。",
                              confirmLabel: "清空",
                              destructive: true,
                            })
                            if (!ok) return
                            void withBusy(`clear-login-${c.id}`, async () => {
                              await apiFetch(`/channels/${c.id}/clear-login-info`, { method: "POST" })
                              toast.success("已清空登录信息")
                            })
                          }}
                        >
                          <XCircle className="size-3.5" />
                          {"清空登录信息"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={busyAction === `delete-${c.id}`}
                          onSelect={async (e) => {
                            e.preventDefault()
                            const ok = await confirm({
                              title: `删除渠道 ${c.name}？`,
                              description: "删除后该渠道的余额历史、倍率快照与登录凭据都将一并清除，且无法恢复。",
                              confirmLabel: "删除",
                              destructive: true,
                            })
                            if (!ok) return
                            void withBusy(`delete-${c.id}`, () =>
                              apiFetch(`/channels/${c.id}`, { method: "DELETE" }),
                            )
                          }}
                        >
                          <Trash2 className="size-3.5" />
                          {"删除"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Card>
              )
            })}
          </div>
          )}

          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-muted/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {pageSizeAll
                ? `显示全部 ${totalChannels} 个渠道`
                : `显示 ${rangeStart}-${rangeEnd} / ${totalChannels} 个渠道`}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{"每页"}</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => {
                    setPageSize(value === "all" ? "all" : Number(value) as ChannelPageSize)
                    setPage(1)
                  }}
                >
                  <SelectTrigger size="sm" className="h-8 w-20 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {channelPageSizeOptions.map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {value === "all" ? "全部" : value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={pageSizeAll || currentPage <= 1}
                  onClick={() => setPage(1)}
                >
                  <ChevronsLeft className="size-3.5" />
                  <span className="hidden sm:inline">{"首页"}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={pageSizeAll || currentPage <= 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  {"上一页"}
                </Button>
                {pageSizeAll ? (
                  <span className="min-w-12 text-center text-xs text-muted-foreground">
                    {"全部"}
                  </span>
                ) : (
                  pagerNumbers.map((pageNumber) => (
                    <Button
                      key={pageNumber}
                      variant={pageNumber === currentPage ? "default" : "outline"}
                      size="sm"
                      className="h-8 min-w-8 px-2 text-xs"
                      onClick={() => setPage(pageNumber)}
                    >
                      {pageNumber}
                    </Button>
                  ))
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={pageSizeAll || currentPage >= totalPages}
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  {"下一页"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={pageSizeAll || currentPage >= totalPages}
                  onClick={() => setPage(totalPages)}
                >
                  <span className="hidden sm:inline">{"末页"}</span>
                  <ChevronsRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <ChannelFormDialog
        open={creating}
        onOpenChange={(v) => {
          setCreating(v)
          if (!v) {
            setEditing(null)
            setPreferCredentialMode(null)
          }
        }}
        channel={editing}
        preferCredentialMode={preferCredentialMode}
      />

      <ChannelImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onFinished={({ synced, writtenIds }) => {
          if (synced || writtenIds.length > 0) {
            setErrorFilter("failed")
            setPage(1)
          }
        }}
      />

      <ChannelRedeemDialog
        open={redeeming != null}
        onOpenChange={(v) => {
          if (!v) setRedeeming(null)
        }}
        channel={redeeming}
        onSuccess={(result) => {
          toast.success(renderRedeemSummary(result))
        }}
      />

      <ChannelRechargeDialog
        open={recharging != null}
        onOpenChange={(v) => {
          if (!v) setRecharging(null)
        }}
        channel={recharging}
      />

      <ChannelAPIKeysDialog
        open={apiKeyDialog != null}
        onOpenChange={(v) => {
          if (!v) setAPIKeyDialog(null)
        }}
        channel={apiKeyDialog?.channel ?? null}
        initialAction={apiKeyDialog?.initialAction}
      />

      {confirmDialog}
    </section>
  )
}
