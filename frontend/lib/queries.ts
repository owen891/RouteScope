"use client"

import { useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/api"
import { useRefreshTick } from "@/lib/refresh-context"
import type {
  AppVersion,
  AdjustmentAudit,
  AdjustmentConfig,
  AdjustmentGroup,
  AdjustmentTarget,
  BalanceTrendPoint,
  CaptchaConfig,
  Channel,
  ChannelPage,
  CostTrendPoint,
  DashboardSummary,
  FeishuControlStatus,
  HealthProbeConfig,
  HealthProbeRun,
  GatewayUsageStats,
  NotificationChannel,
  NotificationLogPage,
  Observation,
  ObservationKind,
  RateComparisonResult,
  RouteAdviceAudit,
  RouteAdviceResult,
  RateChangeLogPage,
  RateSnapshot,
  SystemConfigResponse,
  UpstreamAnnouncementPage,
} from "@/lib/api-types"
import type { ChannelContext, ContextOverview, ContextTimelinePage } from "@/lib/context-types"

export interface QueryState<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
  setData: (data: T) => void
}

/**
 * In-flight 请求去重：同一个 URL 在同一个 tick 内只发一次，所有 useApi 共享 Promise。
 *
 * 为什么需要：useDashboardSummary() 在 5 个组件里都被调用，没去重的话每次 mount /
 * refresh 都会发 5 个相同请求。开发环境叠加 StrictMode 翻倍后会更夸张。
 */
const inflight = new Map<string, Promise<unknown>>()

/** Cache 已完成的响应一小段时间，便于同一帧内挂载的多个组件共享结果（即使第一次的 Promise 已经 resolve）。 */
interface CacheEntry {
  data: unknown
  expiresAt: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 800

function cacheKey(path: string, tick: number, bump: number) {
  return `${path}#${tick}#${bump}`
}

function fetchShared<T>(path: string, key: string): Promise<T> {
  const now = Date.now()

  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) {
    return Promise.resolve(cached.data as T)
  }

  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing

  const p = apiFetch<T>(path)
    .then((d) => {
      cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL_MS })
      return d
    })
    .finally(() => {
      // 让下一帧（refresh tick++）拉到新的数据，不要永远 hold 住旧 promise
      inflight.delete(key)
    })
  inflight.set(key, p)
  return p
}

/**
 * useApi 通用数据获取 hook（stale-while-revalidate）。
 * - 首次加载：loading = true，组件显示加载占位
 * - 后续刷新（refresh tick / refetch）：保留旧 data 继续展示，loading 不切回 true，后台静默拉新
 * - 同 URL + 同 tick 的并发调用共享一次请求
 */
function useApi<T>(path: string | null, watchRefresh = true): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(path !== null)
  const [error, setError] = useState<string | null>(null)
  const [bump, setBump] = useState(0)
  const refreshTick = useRefreshTick()
  const globalTick = watchRefresh ? refreshTick : 0

  // 已经拿到过数据吗？用 ref 防止 setLoading 写回触发额外 effect。
  const hasDataRef = useRef(false)

  useEffect(() => {
    if (path === null) {
      setLoading(false)
      return
    }
    let cancelled = false
    // 关键：只有第一次（还没拿到过数据）才展示 loading；后续 polling / refetch 静默进行，
    // 避免组件因 loading=true 短暂消失再回来造成"闪屏"。
    if (!hasDataRef.current) setLoading(true)
    setError(null)
    fetchShared<T>(path, cacheKey(path, globalTick, bump))
      .then((d) => {
        if (cancelled) return
        hasDataRef.current = true
        setData(d)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path, bump, globalTick])

  return {
    data,
    loading,
    error,
    refetch: () => setBump((b) => b + 1),
    setData: (nextData) => {
      hasDataRef.current = true
      setData(nextData)
    },
  }
}

export function useDashboardSummary() {
  return useApi<DashboardSummary>("/dashboard/summary")
}

/** 本地自然日起止（RFC3339），用于网关用量「今日」统计 */
function localDayRangeISO(day = new Date()): { from: string; to: string } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0)
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999)
  return { from: start.toISOString(), to: end.toISOString() }
}

/** 网关使用记录聚合统计（默认今日本地时区） */
export function useGatewayUsageStatsToday() {
  const { from, to } = localDayRangeISO()
  const qs = new URLSearchParams({ from, to })
  return useApi<GatewayUsageStats>(`/gateway/usage/stats?${qs}`)
}

export function useAppVersion() {
  return useApi<AppVersion>("/version", false)
}

export function useBalanceTrend(days = 7) {
  return useApi<BalanceTrendPoint[]>(`/dashboard/balance-trend?days=${days}`)
}

export function useCostTrend(days = 7) {
  return useApi<CostTrendPoint[]>(`/dashboard/cost-trend?days=${days}`)
}

export function useChannels(enabled = true) {
  return useApi<Channel[]>(enabled ? "/channels" : null)
}

export function useChannelsPage(page = 1, pageSize = 9) {
  return useApi<ChannelPage>(`/channels?page=${page}&page_size=${pageSize}`)
}

export function useChannelRates(channelID: number | null) {
  return useApi<RateSnapshot[]>(channelID == null ? null : `/channels/${channelID}/rates`)
}

/** Loads the visible channel rate summaries with one bounded request instead of one request per row. */
export function useChannelRateSummaries(channelIDs: number[]) {
  const ids = [...new Set(channelIDs)].sort((a, b) => a - b)
  return useApi<RateSnapshot[]>(ids.length > 0 ? `/channels/rates?ids=${ids.join(",")}` : null)
}

// useMultiChannelRates 把多个上游渠道的倍率分组拉回来合并去重，
// 供订阅规则"多选渠道 + 指定分组"场景使用。复用 fetchShared 缓存，
// 单渠道请求仍与 useChannelRates 共享，不会重复打接口。
export function useMultiChannelRates(channelIDs: number[]) {
  const [data, setData] = useState<RateSnapshot[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [bump, setBump] = useState(0)
  const refreshTick = useRefreshTick()
  const key = channelIDs.slice().sort((a, b) => a - b).join(",")

  useEffect(() => {
    if (channelIDs.length === 0) {
      setData(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all(
      channelIDs.map((id) =>
        fetchShared<RateSnapshot[]>(
          `/channels/${id}/rates`,
          cacheKey(`/channels/${id}/rates`, refreshTick, bump),
        ),
      ),
    )
      .then((results) => {
        if (cancelled) return
        setData(results.flat())
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // channelIDs 是数组引用，用排序后的 key 字符串做依赖避免每次渲染都触发
  }, [key, refreshTick, bump])

  return { data, loading, refetch: () => setBump((b) => b + 1) }
}

export function useRateChanges(
  page = 1,
  pageSize = 20,
  channelID?: number,
  modelName?: string,
  remoteGroupID?: number,
) {
  const q = new URLSearchParams()
  q.set("page", String(page))
  q.set("page_size", String(pageSize))
  if (channelID != null) q.set("channel_id", String(channelID))
  if (modelName) q.set("model_name", modelName)
  if (remoteGroupID != null) q.set("remote_group_id", String(remoteGroupID))
  return useApi<RateChangeLogPage>(`/rate-changes?${q.toString()}`)
}

export function useNotificationChannels() {
  return useApi<NotificationChannel[]>("/notifications/channels")
}

export function useNotificationLogs(page = 1, pageSize = 20) {
  return useApi<NotificationLogPage>(
    `/notifications/logs?page=${page}&page_size=${pageSize}`,
  )
}

export function useAnnouncements(page = 1, pageSize = 20) {
  return useApi<UpstreamAnnouncementPage>(
    `/announcements?page=${page}&page_size=${pageSize}`,
  )
}

export function useCaptchaConfigs(enabled = true) {
  return useApi<CaptchaConfig[]>(enabled ? "/captcha-configs" : null)
}

export function useObservations(opts?: {
  channelID?: number
  kind?: ObservationKind | ""
  limit?: number
}) {
  const q = new URLSearchParams()
  if (opts?.channelID != null) q.set("channel_id", String(opts.channelID))
  if (opts?.kind) q.set("kind", opts.kind)
  q.set("limit", String(opts?.limit ?? 100))
  const qs = q.toString()
  return useApi<Observation[]>(`/observations?${qs}`)
}

export function useHealthProbeConfigs() {
  return useApi<HealthProbeConfig[]>("/health-probes/configs")
}

export function useHealthProbeRuns(configID?: number, limit = 20) {
  const q = new URLSearchParams()
  if (configID != null) q.set("config_id", String(configID))
  q.set("limit", String(limit))
  return useApi<HealthProbeRun[]>(`/health-probes/runs?${q.toString()}`)
}

export function useSystemConfig() {
  return useApi<SystemConfigResponse>("/settings/config")
}


export function useComparisonsRates(query = "", deviationPct = 20) {
  const qs = new URLSearchParams()
  if (query.trim()) qs.set("q", query.trim())
  qs.set("deviation_pct", String(deviationPct))
  return useApi<RateComparisonResult>(`/comparisons/rates?${qs.toString()}`)
}

export function useContextOverview(page = 1, pageSize = 20) {
  return useApi<ContextOverview>(`/overview?page=${page}&page_size=${pageSize}`)
}

export function useChannelContext(channelID: number | null) {
  return useApi<ChannelContext>(channelID == null ? null : `/channels/${channelID}/context`)
}

export function useContextTimeline(opts?: {
  resourceKind?: string
  resourceID?: number
  source?: string
  page?: number
  pageSize?: number
}) {
  const q = new URLSearchParams()
  q.set("page", String(opts?.page ?? 1))
  q.set("page_size", String(opts?.pageSize ?? 20))
  if (opts?.resourceKind) q.set("resource_kind", opts.resourceKind)
  if (opts?.resourceID != null) q.set("resource_id", String(opts.resourceID))
  if (opts?.source) q.set("source", opts.source)
  return useApi<ContextTimelinePage>(`/timeline?${q.toString()}`)
}

export function useRouteAdvice(modelName: string) {
  return useApi<RouteAdviceResult>(
    modelName ? `/route-advice?model=${encodeURIComponent(modelName)}` : null,
  )
}

export function useRouteAdviceAudits(modelName: string, limit = 20) {
  const q = new URLSearchParams({ limit: String(limit) })
  if (modelName) q.set("model", modelName)
  return useApi<RouteAdviceAudit[]>(modelName ? `/route-advice/audits?${q.toString()}` : null)
}

export function useAdjustmentTargets() {
  return useApi<AdjustmentTarget[]>("/adjustments/targets")
}

export function useAdjustmentConfig() {
  return useApi<AdjustmentConfig>("/adjustments/config", false)
}

export function useAdjustmentGroups(targetID: number | null) {
  return useApi<AdjustmentGroup[]>(
    targetID == null ? null : `/adjustments/groups?target_id=${targetID}`,
  )
}

export function useAdjustmentAudits(limit = 50) {
  return useApi<AdjustmentAudit[]>(`/adjustments/audits?limit=${limit}`)
}


export function useFeishuControlStatus() {
  return useApi<FeishuControlStatus>("/feishu/status")
}
