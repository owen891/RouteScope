"use client"

import { useMemo, useState } from "react"
import { Activity, Play, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { apiFetch } from "@/lib/api"
import {
  useChannels,
  useHealthProbeConfigs,
  useHealthProbeRuns,
  useObservations,
} from "@/lib/queries"
import { useTriggerRefresh } from "@/lib/refresh-context"
import type { ObservationKind } from "@/lib/api-types"
import { dateTime, relativeTime } from "@/lib/format"

const kindOptions: Array<{ id: "" | ObservationKind; label: string }> = [
  { id: "", label: "全部类型" },
  { id: "balance", label: "余额" },
  { id: "rate", label: "倍率" },
  { id: "cost", label: "消费" },
  { id: "announcement", label: "公告" },
  { id: "health", label: "健康探测" },
]

export default function ObservationsPage() {
  const refresh = useTriggerRefresh()
  const channels = useChannels()
  const [channelFilter, setChannelFilter] = useState<string>("all")
  const [kindFilter, setKindFilter] = useState<"" | ObservationKind>("")
  const channelID = channelFilter === "all" ? undefined : Number(channelFilter)
  const observations = useObservations({
    channelID: Number.isFinite(channelID) ? channelID : undefined,
    kind: kindFilter,
    limit: 100,
  })
  const probeConfigs = useHealthProbeConfigs()
  const probeRuns = useHealthProbeRuns(undefined, 20)

  const channelName = useMemo(() => {
    const map = new Map<number, string>()
    for (const c of channels.data ?? []) map.set(c.id, c.name)
    return map
  }, [channels.data])

  const [probeName, setProbeName] = useState("")
  const [probeURL, setProbeURL] = useState("")
  const [probeChannel, setProbeChannel] = useState<string>("none")
  const [creating, setCreating] = useState(false)
  const [runningID, setRunningID] = useState<number | null>(null)

  async function createProbe() {
    const name = probeName.trim()
    if (!name) {
      toast.error("请填写探测名称")
      return
    }
    const url = probeURL.trim()
    const channel_id = probeChannel === "none" ? undefined : Number(probeChannel)
    if (!url && !channel_id) {
      toast.error("请填写 URL，或绑定一个渠道")
      return
    }
    setCreating(true)
    try {
      await apiFetch("/health-probes/configs", {
        method: "POST",
        body: JSON.stringify({
          name,
          url: url || undefined,
          channel_id: channel_id || undefined,
          enabled: true,
          timeout_ms: 5000,
        }),
      })
      toast.success("探测配置已创建")
      setProbeName("")
      setProbeURL("")
      setProbeChannel("none")
      refresh()
    } catch (e) {
      toast.error((e as Error).message || "创建失败")
    } finally {
      setCreating(false)
    }
  }

  async function runProbe(id: number) {
    setRunningID(id)
    try {
      const res = await apiFetch<{
        success: boolean
        status_code?: number
        latency_ms: number
        error_message?: string
      }>(`/health-probes/configs/${id}/run`, { method: "POST", body: "{}" })
      if (res.success) {
        toast.success(`探测成功 · ${res.latency_ms}ms · HTTP ${res.status_code ?? "-"}`)
      } else {
        toast.warning(res.error_message || "探测失败")
      }
      refresh()
    } catch (e) {
      toast.error((e as Error).message || "探测失败")
    } finally {
      setRunningID(null)
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">观测事实</h1>
          <p className="text-xs text-muted-foreground">
            Phase 5：查看监控扫描沉淀的 observations，并管理健康探测。
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => refresh()}
        >
          <RefreshCw className="size-3.5" />
          刷新
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4" />
            Observations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>渠道</Label>
              <Select value={channelFilter} onValueChange={setChannelFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="全部渠道" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部渠道</SelectItem>
                  {(channels.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>类型</Label>
              <Select
                value={kindFilter || "all"}
                onValueChange={(v) => setKindFilter(v === "all" ? "" : (v as ObservationKind))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kindOptions.map((k) => (
                    <SelectItem key={k.id || "all"} value={k.id || "all"}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {observations.loading && !observations.data ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : observations.error ? (
            <p className="text-sm text-destructive">{observations.error}</p>
          ) : (observations.data ?? []).length === 0 ? (
            <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              暂无观测记录。手动刷新渠道余额/倍率，或等待定时扫描后会出现。
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">时间</th>
                    <th className="px-3 py-2 font-medium">渠道</th>
                    <th className="px-3 py-2 font-medium">类型</th>
                    <th className="px-3 py-2 font-medium">来源</th>
                    <th className="px-3 py-2 font-medium">结果</th>
                    <th className="px-3 py-2 font-medium">摘要</th>
                  </tr>
                </thead>
                <tbody>
                  {(observations.data ?? []).map((o) => (
                    <tr key={o.id} className="border-t border-border/70">
                      <td className="px-3 py-2 whitespace-nowrap" title={dateTime(o.sampled_at)}>
                        {relativeTime(o.sampled_at)}
                      </td>
                      <td className="px-3 py-2">
                        {channelName.get(o.channel_id) ?? `#${o.channel_id}`}
                      </td>
                      <td className="px-3 py-2">{o.kind}</td>
                      <td className="px-3 py-2">{o.source}</td>
                      <td className="px-3 py-2">
                        <Badge variant={o.success ? "secondary" : "destructive"}>
                          {o.success ? "ok" : o.error_class || "fail"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 max-w-md truncate" title={o.summary || o.error_message}>
                        {o.summary || o.error_message || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">健康探测配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="probe-name">名称</Label>
                <Input
                  id="probe-name"
                  value={probeName}
                  onChange={(e) => setProbeName(e.target.value)}
                  placeholder="例如：主站可达性"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="probe-url">URL（可选）</Label>
                <Input
                  id="probe-url"
                  value={probeURL}
                  onChange={(e) => setProbeURL(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>绑定渠道（可选）</Label>
                <Select value={probeChannel} onValueChange={setProbeChannel}>
                  <SelectTrigger>
                    <SelectValue placeholder="不绑定" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不绑定</SelectItem>
                    {(channels.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button className="gap-1.5" onClick={createProbe} disabled={creating}>
                <Plus className="size-3.5" />
                {creating ? "创建中…" : "创建探测"}
              </Button>
            </div>

            <div className="space-y-2">
              {(probeConfigs.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">还没有探测配置。</p>
              ) : (
                (probeConfigs.data ?? []).map((cfg) => (
                  <div
                    key={cfg.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{cfg.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {cfg.url ||
                          (cfg.channel_id
                            ? `渠道 #${cfg.channel_id} 站点根路径`
                            : "未配置 URL")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      disabled={runningID === cfg.id}
                      onClick={() => runProbe(cfg.id)}
                    >
                      <Play className="size-3" />
                      {runningID === cfg.id ? "探测中" : "运行"}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">最近探测运行</CardTitle>
          </CardHeader>
          <CardContent>
            {(probeRuns.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无运行记录。</p>
            ) : (
              <div className="space-y-2">
                {(probeRuns.data ?? []).map((run) => (
                  <div
                    key={run.id}
                    className="rounded-lg border border-border px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        config #{run.config_id} · {run.latency_ms}ms
                      </span>
                      <Badge variant={run.success ? "secondary" : "destructive"}>
                        {run.success ? `HTTP ${run.status_code ?? "-"}` : run.error_class || "fail"}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-muted-foreground" title={run.url}>
                      {run.url}
                    </p>
                    <p className="mt-0.5 text-muted-foreground" title={dateTime(run.started_at)}>
                      {relativeTime(run.started_at)}
                      {run.error_message ? ` · ${run.error_message}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
