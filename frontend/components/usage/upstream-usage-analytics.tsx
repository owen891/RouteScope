import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Coins,
  Database,
  FileText,
  Gauge,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiFetch } from "@/lib/api"
import type { UpstreamUsageResponse, UpstreamUsageTotals } from "@/lib/api-types"
import { formatDurationMS, formatTokens } from "@/lib/format"
import { useChannels } from "@/lib/queries"
import {
  aggregateUsageTrend,
  buildChannelUsageRecommendations,
  flattenUsageGroups,
  flattenUsageModels,
  groupUsageModels,
  usageDateRange,
  usageUnitMetrics,
} from "@/lib/upstream-usage"
import { cn } from "@/lib/utils"

type RangePreset = "today" | "7d" | "30d" | "custom"
type UsageView = "overview" | "models" | "distribution"

const EMPTY_TOTALS: UpstreamUsageTotals = {
  requests: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  total_tokens: 0,
  actual_cost: 0,
  standard_cost: 0,
  average_duration_ms: 0,
}

function usd(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "$0.00"
  const fractionDigits = Math.abs(value) > 0 && Math.abs(value) < 0.01
    ? Math.max(digits, 4)
    : digits
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`
}

function unitUsd(value: number) {
  const absoluteValue = Math.abs(value)
  const digits = absoluteValue >= 100 ? 2 : absoluteValue >= 1 ? 3 : 4
  return usd(value, digits)
}

function fullNumber(value: number) {
  return Math.round(value).toLocaleString("en-US")
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof FileText
  label: string
  value: string
  detail: string
  tone: "blue" | "amber" | "emerald" | "violet"
}) {
  const tones = {
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  }
  return (
    <div className="flex min-h-20 min-w-0 items-center gap-3 border-border px-3 py-3 sm:px-4">
      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", tones[tone])}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate text-lg font-semibold tabular-nums" title={value}>{value}</div>
        <div className="mt-0.5 truncate text-[10px] leading-4 text-muted-foreground" title={detail}>{detail}</div>
      </div>
    </div>
  )
}

export function UpstreamUsageAnalytics() {
  const initialRange = useMemo(() => usageDateRange(7), [])
  const [startDate, setStartDate] = useState(initialRange.start)
  const [endDate, setEndDate] = useState(initialRange.end)
  const [channelID, setChannelID] = useState("all")
  const [modelFilter, setModelFilter] = useState("all")
  const [usageView, setUsageView] = useState<UsageView>("overview")
  const [selectedDistributionChannelID, setSelectedDistributionChannelID] = useState<number | null>(null)
  const [preset, setPreset] = useState<RangePreset>("7d")
  const [data, setData] = useState<UpstreamUsageResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const loadedRef = useRef(false)
  const channelsQuery = useChannels()

  async function load(nextStart = startDate, nextEnd = endDate, nextChannel = channelID, forceRefresh = false) {
    if (!nextStart || !nextEnd) {
      setError("请选择完整的开始和结束日期")
      return
    }
    setLoading(true)
    setError("")
    try {
      const qs = new URLSearchParams({ start_date: nextStart, end_date: nextEnd })
      if (nextChannel !== "all") qs.set("channel_id", nextChannel)
      if (forceRefresh) qs.set("refresh", "true")
      const response = await apiFetch<UpstreamUsageResponse>(`/channels/usage-analytics?${qs}`)
      setData({
        ...response,
        totals: response.totals ?? EMPTY_TOTALS,
        channels: response.channels ?? [],
        errors: response.errors ?? [],
        cache: response.cache ?? {
          persisted: false,
          fresh_for_seconds: 0,
          cached_channels: 0,
          live_channels: response.channels?.length ?? 0,
          refreshing_channels: 0,
          generated_at: new Date().toISOString(),
        },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载上游真实消费失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void load(initialRange.start, initialRange.end, "all")
  }, [initialRange.end, initialRange.start])

  function applyPreset(nextPreset: Exclude<RangePreset, "custom">) {
    const days = nextPreset === "today" ? 1 : nextPreset === "7d" ? 7 : 30
    const range = usageDateRange(days)
    setPreset(nextPreset)
    setStartDate(range.start)
    setEndDate(range.end)
    void load(range.start, range.end, channelID)
  }

  function selectChannel(nextChannel: string) {
    setChannelID(nextChannel)
    void load(startDate, endDate, nextChannel)
  }

  const totals = data?.totals ?? EMPTY_TOTALS
  const modelRows = useMemo(() => flattenUsageModels(data?.channels ?? []), [data?.channels])
  const modelGroups = useMemo(() => groupUsageModels(modelRows), [modelRows])
  const visibleModelGroups = useMemo(
    () => modelFilter === "all" ? modelGroups : modelGroups.filter((group) => group.model === modelFilter),
    [modelFilter, modelGroups],
  )
  const visibleModelRowCount = visibleModelGroups.reduce((sum, group) => sum + group.rows.length, 0)
  const groupRows = useMemo(() => flattenUsageGroups(data?.channels ?? []), [data?.channels])
  const distributionChannels = useMemo(
    () => [...(data?.channels ?? [])].sort((a, b) => b.totals.actual_cost - a.totals.actual_cost),
    [data?.channels],
  )
  const activeDistributionChannelID = selectedDistributionChannelID != null &&
    distributionChannels.some((channel) => channel.channel_id === selectedDistributionChannelID)
    ? selectedDistributionChannelID
    : null
  const selectedDistributionChannel = activeDistributionChannelID == null
    ? null
    : distributionChannels.find((channel) => channel.channel_id === activeDistributionChannelID) ?? null
  const visibleGroupRows = useMemo(
    () => activeDistributionChannelID == null
      ? groupRows
      : groupRows.filter((item) => item.channel_id === activeDistributionChannelID),
    [activeDistributionChannelID, groupRows],
  )
  const trend = useMemo(() => aggregateUsageTrend(data?.channels ?? []), [data?.channels])
  const savings = totals.standard_cost > 0
    ? Math.max(0, (1 - totals.actual_cost / totals.standard_cost) * 100)
    : 0
  const unitMetrics = usageUnitMetrics(totals)
  const recommendations = useMemo(
    () => buildChannelUsageRecommendations(data?.channels ?? [], data?.errors ?? []),
    [data?.channels, data?.errors],
  )
  const overallRecommendation = recommendations.find((item) => item.labels.includes("\u7efc\u5408\u63a8\u8350"))
  useEffect(() => {
    if (modelFilter !== "all" && !modelGroups.some((group) => group.model === modelFilter)) {
      setModelFilter("all")
    }
  }, [modelFilter, modelGroups])

  return (
    <section className="min-w-0 space-y-4">
      <Tabs value={usageView} onValueChange={(value) => setUsageView(value as UsageView)} className="min-w-0 gap-3">
        <div className="section-toolbar items-start sm:items-center">
          <TabsList aria-label="真实消费视图" className="w-full bg-muted/40 sm:w-fit">
            <TabsTrigger value="overview">渠道总览</TabsTrigger>
            <TabsTrigger value="models">模型消费</TabsTrigger>
            <TabsTrigger value="distribution">使用分布</TabsTrigger>
          </TabsList>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/5 text-[10px] text-emerald-700 dark:text-emerald-400">
              上游账单 API
            </Badge>
            <span className="min-w-0 flex-1 truncate">actual_cost / cost · 不含本地报价、充值倍率与转发日志</span>
            {data?.cache.persisted ? (
              <span className="text-[11px]">
                数据库快照 {data.cache.cached_channels} 个 · 实时抓取 {data.cache.live_channels} 个
                {data.cache.refreshing_channels > 0 ? ` · 后台刷新 ${data.cache.refreshing_channels} 个` : ""}
              </span>
            ) : null}
          </div>
          <Button type="button" variant="outline" size="sm" className="ml-auto" disabled={loading} onClick={() => void load(startDate, endDate, channelID, true)}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            刷新账单
          </Button>
        </div>

      <Card className="grid grid-cols-2 gap-0 overflow-hidden p-0 [&>*]:border-b [&>*]:border-r md:grid-cols-3 2xl:grid-cols-6 2xl:[&>*]:border-b-0 2xl:[&>*:last-child]:border-r-0">
        <SummaryMetric icon={FileText} label="总请求数" value={fullNumber(totals.requests)} detail={`${data?.start_date ?? startDate} 至 ${data?.end_date ?? endDate}`} tone="blue" />
        <SummaryMetric icon={Database} label="总 Token" value={formatTokens(totals.total_tokens)} detail={`平均每次 ${formatTokens(unitMetrics.tokensPerRequest)}`} tone="amber" />
        <SummaryMetric icon={Coins} label="实际消费" value={usd(totals.actual_cost)} detail={`标准 ${usd(totals.standard_cost)}${totals.standard_cost > 0 ? ` · 节省 ${savings.toFixed(1)}%` : ""}`} tone="emerald" />
        <SummaryMetric icon={Gauge} label="实际每百万 Token" value={usd(unitMetrics.actualPerMillion, 4)} detail={`标准 ${usd(unitMetrics.standardPerMillion, 4)}`} tone="emerald" />
        <SummaryMetric icon={CircleDollarSign} label="单次调用均价" value={usd(unitMetrics.actualPerRequest, 4)} detail={`${fullNumber(totals.requests)} 次调用均价`} tone="amber" />
        <SummaryMetric icon={Clock3} label="平均耗时" value={formatDurationMS(totals.average_duration_ms)} detail={`${data?.channels.length ?? 0} 个上游有统计`} tone="violet" />
      </Card>

      <Card className="gap-0">
        <CardContent className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <div className="inline-flex h-9 items-center rounded-md border border-border bg-muted/30 p-0.5" role="group" aria-label="时间范围">
                {([
                  ["today", "今日"],
                  ["7d", "近 7 天"],
                  ["30d", "近 30 天"],
                ] as const).map(([value, label]) => (
                  <Button key={value} type="button" size="sm" variant="ghost" className={cn("h-8 px-3", preset === value && "bg-background text-foreground shadow-sm")} onClick={() => applyPreset(value)}>
                    {label}
                  </Button>
                ))}
          </div>
          <div className="flex items-center gap-1.5">
              <Input
                aria-label="开始日期"
                type="date"
                className="h-9 w-[142px]"
                value={startDate}
                onChange={(event) => { setStartDate(event.target.value); setPreset("custom") }}
              />
              <span className="text-xs text-muted-foreground">至</span>
              <Input
                aria-label="结束日期"
                type="date"
                className="h-9 w-[142px]"
                value={endDate}
                onChange={(event) => { setEndDate(event.target.value); setPreset("custom") }}
              />
          </div>
            <Button type="button" size="sm" variant={preset === "custom" ? "default" : "outline"} className="h-9" disabled={loading} onClick={() => void load()}>
              <CalendarDays className="size-4" />
              查询
            </Button>
          <div className="ml-auto min-w-[210px]">
            <Select value={channelID} onValueChange={selectChannel}>
              <SelectTrigger className="h-9 w-full lg:w-[240px]" aria-label="上游渠道">
                <SelectValue placeholder="全部上游" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部上游</SelectItem>
                {(channelsQuery.data ?? []).map((channel) => (
                  <SelectItem key={channel.id} value={String(channel.id)}>
                    {channel.name} · {channel.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>真实消费加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <TabsContent value="overview" className="mt-0 min-w-0">
      <Card className="min-w-0 gap-0 overflow-hidden">
        <CardHeader className="gap-1 border-b px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-start gap-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="size-4 text-amber-500" />渠道性价比与稳定性</CardTitle>
            {overallRecommendation ? <Badge className="gap-1"><ShieldCheck className="size-3" />综合推荐：{overallRecommendation.channel_name}</Badge> : null}
          </div>
          <p className="truncate text-[11px] text-muted-foreground" title="稳定性基于账单 API 可用状态、平均耗时和样本量估算，不等同于长期 SLA；不同模型与分组结构会影响单位成本。">综合分：性价比 60% · 稳定性 40%</p>
        </CardHeader>
        <CardContent className="px-0">
          {recommendations.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">暂无可比较的渠道数据</div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table className="min-w-[1060px] table-fixed [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
                  <colgroup><col className="w-[240px]" /><col className="w-[90px]" /><col className="w-[145px]" /><col className="w-[120px]" /><col className="w-[105px]" /><col className="w-[155px]" /><col className="w-[300px]" /></colgroup>
                  <TableHeader className="bg-muted/35 text-[11px] text-muted-foreground"><TableRow>
                    <TableHead>推荐 / 渠道</TableHead><TableHead className="text-right">请求</TableHead><TableHead className="text-right">实际 $/百万 Token</TableHead><TableHead className="text-right">实际 $/次</TableHead><TableHead className="text-right">平均耗时</TableHead><TableHead className="text-right">评分</TableHead><TableHead>建议依据</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {recommendations.map((item) => (
                      <TableRow key={item.channel_id}>
                        <TableCell><div className="flex flex-wrap items-center gap-1"><span className="font-medium">{item.channel_name}</span>{item.labels.map((label) => <Badge key={label} variant={label === "综合推荐" ? "default" : "outline"} className="text-[10px]">{label}</Badge>)}{!item.eligible ? <Badge variant="secondary" className="text-[10px]">{item.unavailable ? "不可用" : "仅观察"}</Badge> : null}</div><div className="text-[10px] text-muted-foreground">{item.channel_type}</div></TableCell>
                        <TableCell className="text-right tabular-nums">{fullNumber(item.requests)}</TableCell>
                        <TableCell className="text-right font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">{item.actualPerMillion > 0 ? usd(item.actualPerMillion, 4) : "--"}</TableCell>
                        <TableCell className="text-right tabular-nums">{item.actualPerRequest > 0 ? usd(item.actualPerRequest, 4) : "--"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatDurationMS(item.average_duration_ms)}</TableCell>
                        <TableCell className="text-right tabular-nums"><div className="font-semibold text-foreground">{item.overallScore.toFixed(1)}</div><div className="mt-0.5 text-[10px] text-muted-foreground">性价 {item.costScore.toFixed(0)} · 稳定 {item.stabilityScore.toFixed(0)}</div></TableCell>
                        <TableCell><p className="line-clamp-2 whitespace-normal text-xs leading-4 text-muted-foreground" title={item.reason}>{item.reason}</p></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="grid gap-3 p-3 md:hidden">
                {recommendations.map((item) => (
                  <div key={item.channel_id} className="surface-panel p-3">
                    <div className="flex flex-wrap items-center gap-1"><span className="font-medium">{item.channel_name}</span>{item.labels.map((label) => <Badge key={label} variant={label === "综合推荐" ? "default" : "outline"} className="text-[10px]">{label}</Badge>)}{!item.eligible ? <Badge variant="secondary" className="text-[10px]">{item.unavailable ? "不可用" : "仅观察"}</Badge> : null}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div><div className="text-muted-foreground">实际 $/百万 Token</div><div className="font-semibold text-emerald-600 tabular-nums">{item.actualPerMillion > 0 ? usd(item.actualPerMillion, 4) : "--"}</div></div>
                      <div><div className="text-muted-foreground">实际 $/次</div><div className="font-medium tabular-nums">{item.actualPerRequest > 0 ? usd(item.actualPerRequest, 4) : "--"}</div></div>
                      <div><div className="text-muted-foreground">平均耗时</div><div className="font-medium tabular-nums">{formatDurationMS(item.average_duration_ms)}</div></div>
                      <div><div className="text-muted-foreground">综合分</div><div className="font-semibold tabular-nums">{item.overallScore.toFixed(1)}</div></div>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">{item.reason}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      </TabsContent>
      <TabsContent value="models" className="mt-0 min-w-0">
      <Card className="min-w-0 gap-0 overflow-hidden">
        <CardHeader className="gap-3 border-b px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-sm">模型消费明细</CardTitle>
            <p className="text-xs text-muted-foreground">先按模型分组，再对比同一模型在不同上游的请求量、Token 和实际消费。</p>
          </div>
          <div className="w-full shrink-0 space-y-1 sm:w-64">
            <div className="text-[11px] text-muted-foreground">模型筛选</div>
            <Select value={modelFilter} onValueChange={setModelFilter}>
              <SelectTrigger className="w-full" aria-label="模型筛选">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部模型（{modelGroups.length}）</SelectItem>
                {modelGroups.map((group) => (
                  <SelectItem key={group.model} value={group.model}>
                    {group.model}（{group.channelCount} 个渠道）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading && !data ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />读取上游账单...</div>
          ) : modelRows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Database className="size-8 opacity-40" />当前范围没有模型消费记录
            </div>
          ) : visibleModelRowCount === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Database className="size-8 opacity-40" />当前筛选没有模型消费记录
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table className="min-w-[1500px] [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[210px]">模型</TableHead>
                      <TableHead className="min-w-[190px]">上游渠道</TableHead>
                      <TableHead className="text-right">请求次数</TableHead>
                      <TableHead className="text-right">输入 Token</TableHead>
                      <TableHead className="text-right">输出 Token</TableHead>
                      <TableHead className="text-right">缓存读取</TableHead>
                      <TableHead className="text-right">总 Token</TableHead>
                      <TableHead className="min-w-[145px] text-right">百万 Token 费用</TableHead>
                      <TableHead className="min-w-[130px] text-right">单次调用均价</TableHead>
                      <TableHead className="text-right">实际消费</TableHead>
                      <TableHead className="text-right">标准消费</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleModelGroups.map((group, groupIndex) =>
                      group.rows.map((item, rowIndex) => (
                        <TableRow
                          key={`${item.channel_id}:${group.model}`}
                          className={cn(groupIndex > 0 && rowIndex === 0 && "border-t-2")}
                        >
                          {rowIndex === 0 ? (
                            <TableCell rowSpan={group.rows.length} className="align-top bg-muted/20 py-4">
                              <div className="font-mono text-xs font-semibold text-foreground">{group.model}</div>
                              <div className="mt-1 text-[10px] text-muted-foreground">{group.channelCount} 个渠道 · {group.rows.length} 条记录</div>
                              <div className="mt-2 text-xs font-medium text-emerald-600 tabular-nums dark:text-emerald-400">合计 {usd(group.actualCost)}</div>
                            </TableCell>
                          ) : null}
                          <TableCell>
                            <div className="font-medium">{item.channel_name}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">{item.channel_type}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fullNumber(item.requests)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatTokens(item.input_tokens)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatTokens(item.output_tokens)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatTokens(item.cache_read_tokens)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatTokens(item.total_tokens)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{unitUsd(usageUnitMetrics(item).actualPerMillion)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{unitUsd(usageUnitMetrics(item).actualPerRequest)}</TableCell>
                          <TableCell className="text-right font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">{usd(item.actual_cost)}</TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">{usd(item.standard_cost)}</TableCell>
                        </TableRow>
                      )),
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y md:hidden">
                {visibleModelGroups.map((group) => (
                  <div key={group.model}>
                    <div className="flex items-start justify-between gap-3 bg-muted/35 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm font-semibold">{group.model}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{group.channelCount} 个渠道 · {group.rows.length} 条记录</div>
                      </div>
                      <div className="shrink-0 text-right text-xs font-medium text-emerald-600 tabular-nums dark:text-emerald-400">合计 {usd(group.actualCost)}</div>
                    </div>
                    <div className="divide-y">
                      {group.rows.map((item) => (
                        <div key={`${item.channel_id}:${group.model}`} className="space-y-3 px-4 py-4">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{item.channel_name}</div>
                              <div className="mt-0.5 text-[10px] uppercase text-muted-foreground">{item.channel_type}</div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">{usd(item.actual_cost)}</div>
                              <div className="text-[10px] text-muted-foreground">标准 {usd(item.standard_cost)}</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                            <div><div className="text-[10px] text-muted-foreground">请求次数</div><div className="font-medium tabular-nums">{fullNumber(item.requests)}</div></div>
                            <div><div className="text-[10px] text-muted-foreground">总 Token</div><div className="font-medium tabular-nums">{formatTokens(item.total_tokens)}</div></div>
                            <div><div className="text-[10px] text-muted-foreground">百万 Token 费用</div><div className="font-medium tabular-nums">{unitUsd(usageUnitMetrics(item).actualPerMillion)}</div></div>
                            <div><div className="text-[10px] text-muted-foreground">单次调用均价</div><div className="font-medium tabular-nums">{unitUsd(usageUnitMetrics(item).actualPerRequest)}</div></div>
                            <div><div className="text-[10px] text-muted-foreground">输入 Token</div><div className="font-medium tabular-nums">{formatTokens(item.input_tokens)}</div></div>
                            <div><div className="text-[10px] text-muted-foreground">输出 Token</div><div className="font-medium tabular-nums">{formatTokens(item.output_tokens)}</div></div>
                            <div><div className="text-[10px] text-muted-foreground">缓存读取</div><div className="font-medium tabular-nums">{formatTokens(item.cache_read_tokens)}</div></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      </TabsContent>
      <TabsContent value="distribution" className="mt-0 min-w-0">
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card className="min-w-0 gap-0 overflow-hidden">
          <CardHeader className="border-b px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">上游消费分布</CardTitle>
              {selectedDistributionChannel ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => setSelectedDistributionChannelID(null)}
                >
                  全部上游
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="divide-y px-0">
            {(data?.channels.length ?? 0) === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">没有可展示的上游统计</div>
            ) : distributionChannels.map((channel) => {
                const share = totals.actual_cost > 0 ? channel.totals.actual_cost / totals.actual_cost * 100 : 0
                const selected = activeDistributionChannelID === channel.channel_id
                return (
                  <button
                    key={channel.channel_id}
                    type="button"
                    aria-label={`选择上游 ${channel.channel_name}`}
                    aria-pressed={selected}
                    onClick={() => setSelectedDistributionChannelID(channel.channel_id)}
                    className={cn(
                      "w-full space-y-2.5 px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5",
                      selected && "bg-primary/5 ring-1 ring-inset ring-primary/35",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2"><Server className="size-4 text-muted-foreground" /><span className="truncate font-medium">{channel.channel_name}</span></div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{fullNumber(channel.totals.requests)} 请求 · {formatTokens(channel.totals.total_tokens)} Token</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">{usd(channel.totals.actual_cost)}</div>
                        <div className="text-[10px] text-muted-foreground">标准 {usd(channel.totals.standard_cost)}</div>
                      </div>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, share)}%` }} />
                    </div>
                  </button>
                )
              })}
          </CardContent>
        </Card>

        <Card className="min-w-0 gap-0 overflow-hidden">
          <CardHeader className="border-b px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-sm">分组使用分布</CardTitle>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {selectedDistributionChannel
                    ? `当前显示：${selectedDistributionChannel.channel_name}`
                    : "点击左侧上游，查看对应分组"}
                </p>
              </div>
              {selectedDistributionChannel ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 px-2 text-xs"
                  onClick={() => setSelectedDistributionChannelID(null)}
                >
                  清除筛选
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="px-0">
            {visibleGroupRows.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {selectedDistributionChannel
                  ? `${selectedDistributionChannel.channel_name} 未提供分组统计`
                  : "当前上游未提供分组统计"}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[620px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>上游 / 分组</TableHead>
                      <TableHead className="text-right">请求</TableHead>
                      <TableHead className="text-right">总 Token</TableHead>
                      <TableHead className="text-right">实际</TableHead>
                      <TableHead className="text-right">标准</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleGroupRows.map((item) => (
                      <TableRow key={`${item.channel_id}:${item.group_id}:${item.group_name}`}>
                        <TableCell><div className="font-medium">{item.group_name || `分组 ${item.group_id}`}</div><div className="text-[10px] text-muted-foreground">{item.channel_name}</div></TableCell>
                        <TableCell className="text-right tabular-nums">{fullNumber(item.requests)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatTokens(item.total_tokens)}</TableCell>
                        <TableCell className="text-right font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">{usd(item.actual_cost)}</TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">{usd(item.standard_cost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0 gap-0 overflow-hidden">
        <CardHeader className="border-b px-4 py-4 sm:px-5">
          <CardTitle className="text-sm">Token 使用趋势</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] px-2 py-4 sm:px-4">
          {trend.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">当前上游未提供趋势统计</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="usageInput" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4f7ff0" stopOpacity={0.28} /><stop offset="95%" stopColor="#4f7ff0" stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="usageCache" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22a9c7" stopOpacity={0.3} /><stop offset="95%" stopColor="#22a9c7" stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.35} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => formatTokens(Number(value))} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
                <ChartTooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="cache_read_tokens" name="缓存读取" stroke="#22a9c7" fill="url(#usageCache)" strokeWidth={2} />
                <Area type="monotone" dataKey="input_tokens" name="输入 Token" stroke="#4f7ff0" fill="url(#usageInput)" strokeWidth={2} />
                <Area type="monotone" dataKey="output_tokens" name="输出 Token" stroke="#35b779" fill="#35b779" fillOpacity={0.08} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      </TabsContent>
      </Tabs>
    </section>
  )
}
