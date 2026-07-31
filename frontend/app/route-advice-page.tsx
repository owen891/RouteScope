"use client"

import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, Check, RefreshCw, Route, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { apiFetch } from "@/lib/api"
import { dateTime, relativeTime } from "@/lib/format"
import { useComparisonsRates, useRouteAdvice, useRouteAdviceAudits } from "@/lib/queries"
import { useTriggerRefresh } from "@/lib/refresh-context"
import type { RouteAdviceCandidate } from "@/lib/api-types"

const labels: Record<string, string> = {
  current_primary: "当前主路由",
  no_channel_error: "渠道无错误",
  recent_probe_healthy: "探测健康",
  balance_safe: "余额安全",
  competitive_rate: "倍率有竞争力",
  rate_fresh: "倍率新鲜",
  monitor_disabled: "监控已停用",
  credential_invalid: "凭据失效",
  network_error: "网络异常",
  channel_error: "渠道异常",
  probe_failed: "健康探测失败",
  health_stale: "健康事实过期",
  health_unknown: "缺少健康事实",
  balance_unknown: "余额未知",
  low_balance: "余额低于阈值",
  invalid_rate: "倍率无效",
  above_median_rate: "倍率高于中位",
  rate_stale: "倍率已过期",
}

function fmt(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—"
  return String(Number(value.toFixed(6)))
}

export default function RouteAdvicePage() {
  const refresh = useTriggerRefresh()
  const navigate = useNavigate()
  const comparisons = useComparisonsRates("", 20)
  const modelNames = comparisons.data?.model_names ?? []
  const [modelName, setModelName] = useState("")
  const [confirming, setConfirming] = useState<RouteAdviceCandidate | null>(null)
  const [saving, setSaving] = useState(false)
  const advice = useRouteAdvice(modelName)
  const audits = useRouteAdviceAudits(modelName)
  const currentPrimary = advice.data?.current_primary

  useEffect(() => {
    if (!modelName && modelNames.length > 0) setModelName(modelNames[0])
  }, [modelName, modelNames])

  const channelNames = useMemo(() => {
    const result = new Map<number, string>()
    for (const candidate of advice.data?.candidates ?? []) {
      result.set(candidate.channel_id, candidate.channel_name)
    }
    return result
  }, [advice.data])

  function openGateway(channelID: number) {
    const qs = new URLSearchParams({
      model: modelName,
      channel_id: String(channelID),
    })
    navigate(`/gateway?${qs.toString()}`)
  }

  async function confirmPrimary() {
    if (!confirming || !modelName) return
    setSaving(true)
    try {
      const result = await apiFetch<{ changed: boolean }>("/route-advice/primary", {
        method: "POST",
        body: JSON.stringify({
          model_name: modelName,
          channel_id: confirming.channel_id,
          confirm: true,
        }),
      })
      toast.success(result.changed ? "主路由决策已保存" : "该渠道已经是当前主路由")
      setConfirming(null)
      refresh()
    } catch (error) {
      toast.error((error as Error).message || "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">路由建议</h1>
          <p className="text-xs text-muted-foreground">基于倍率、余额、健康状态和数据新鲜度生成候选顺序；保存决策不会自动切流。</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refresh()}>
          <RefreshCw className="size-3.5" />
          刷新
        </Button>
      </header>

      <Card className="overflow-hidden">
        <CardContent className="grid gap-3 p-3 sm:grid-cols-[minmax(240px,0.8fr)_minmax(300px,1.2fr)] sm:items-stretch">
          <div className="space-y-1.5 rounded-lg border border-border bg-background p-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">评估对象</span>
            <Select value={modelName} onValueChange={setModelName}>
              <SelectTrigger className="bg-card"><SelectValue placeholder="选择模型或分组" /></SelectTrigger>
              <SelectContent>
                {modelNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/45 p-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">当前人工决策</p>
              <p className="mt-1 truncate text-sm font-semibold text-foreground">
                {advice.data?.current_primary
                  ? channelNames.get(advice.data.current_primary.channel_id) ?? `#${advice.data.current_primary.channel_id}`
                  : "尚未保存"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">仅记录决策；如需让真实请求自动选路，可再启用高级网关。</p>
            </div>
            {currentPrimary ? (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => openGateway(currentPrimary.channel_id)}
              >
                高级：配置 API 转发网关 <ArrowRight className="size-3.5" />
              </Button>
            ) : (
              <Badge variant="outline" className="bg-background">待确认</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {!modelName ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/15 px-4 py-8 text-center text-sm">
          <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Route className="size-4" />
          </span>
          <p className="mt-3 font-medium text-foreground">还没有可用于评分的倍率数据</p>
          <p className="mt-1 text-muted-foreground">先回到总览同步渠道倍率，再查看候选路由。</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={() => navigate("/")}>返回总览同步渠道</Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/comparisons")}>查看渠道对比</Button>
          </div>
        </div>
      ) : advice.loading && !advice.data ? (
        <p className="text-sm text-muted-foreground">生成候选中…</p>
      ) : advice.error ? (
        <p className="text-sm text-destructive">{advice.error}</p>
      ) : (advice.data?.candidates ?? []).length === 0 ? (
        <p className="rounded border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
          当前模型没有可用的渠道倍率快照。
        </p>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Route className="size-4" />候选路由
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">优先级</th>
                  <th className="px-3 py-2 font-medium">渠道</th>
                  <th className="px-3 py-2 font-medium">评分</th>
                  <th className="px-3 py-2 font-medium">倍率</th>
                  <th className="px-3 py-2 font-medium">余额</th>
                  <th className="px-3 py-2 font-medium">依据与风险</th>
                  <th className="px-3 py-2 font-medium">动作</th>
                </tr>
              </thead>
              <tbody>
                {(advice.data?.candidates ?? []).map((candidate) => (
                  <tr key={candidate.channel_id} className="border-t border-border/70 align-top">
                    <td className="px-3 py-3">#{candidate.priority}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium">{candidate.channel_name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {candidate.recommended ? <Badge variant="secondary">推荐</Badge> : null}
                        {candidate.current_primary ? <Badge>Primary</Badge> : null}
                        {!candidate.eligible ? <Badge variant="destructive">不可选</Badge> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-medium">{candidate.score.toFixed(2)}</td>
                    <td className="px-3 py-3">
                      <div>{fmt(candidate.ratio)}</div>
                      <div className="text-[11px] text-muted-foreground" title={dateTime(candidate.rate_seen_at)}>
                        {relativeTime(candidate.rate_seen_at)}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div>{fmt(candidate.balance)}</div>
                      {candidate.balance_threshold > 0 ? (
                        <div className="text-[11px] text-muted-foreground">阈值 {fmt(candidate.balance_threshold)}</div>
                      ) : null}
                    </td>
                    <td className="max-w-md px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {candidate.reasons.map((code) => (
                          <Badge key={`reason-${code}`} variant="secondary">{labels[code] ?? code}</Badge>
                        ))}
                        {candidate.risks.map((code) => (
                          <Badge key={`risk-${code}`} variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
                            {labels[code] ?? code}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Button
                        size="sm"
                        variant={candidate.current_primary ? "outline" : "default"}
                        disabled={!candidate.eligible || candidate.current_primary}
                        onClick={() => setConfirming(candidate)}
                      >
                        {candidate.current_primary ? <Check className="size-3.5" /> : "保存决策"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">决策审计</CardTitle></CardHeader>
        <CardContent>
          {(audits.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无主路由变更记录。</p>
          ) : (
            <div className="space-y-2">
              {(audits.data ?? []).map((audit) => (
                <div key={audit.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2 text-xs last:border-0">
                  <div>
                    <span className="font-medium">{channelNames.get(audit.channel_id) ?? `#${audit.channel_id}`}</span>
                    <span className="text-muted-foreground">
                      {audit.previous_channel_id ? ` · 从 #${audit.previous_channel_id} 切换` : " · 首次确认"}
                    </span>
                  </div>
                  <span className="text-muted-foreground" title={dateTime(audit.created_at)}>
                    {audit.operator} · {relativeTime(audit.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>保存主路由决策</AlertDialogTitle>
            <AlertDialogDescription>
              将 {confirming?.channel_name ?? "该渠道"} 标记为 {modelName} 的 primary route。此操作只记录人工决策，不会自动修改网关或上游流量。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <ShieldAlert className="size-4 shrink-0" />实际切流仍需在网关或上游配置中单独执行。
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={() => void confirmPrimary()}>
              {saving ? "保存中…" : "确认保存，不执行切流"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
