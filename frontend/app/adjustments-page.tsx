import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Eye,
  History,
  Layers3,
  Loader2,
  Percent,
  RotateCcw,
  Save,
  Scale,
  ShieldAlert,
  Target,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState, StatusBadge } from "@/components/ops/page-primitives"
import { apiFetch } from "@/lib/api"
import { calculateGrossMarginAdjustedRatio } from "@/lib/adjustment"
import { dateTime, relativeTime } from "@/lib/format"
import { useAdjustmentAudits, useAdjustmentConfig, useAdjustmentGroups, useAdjustmentTargets } from "@/lib/queries"
import { useTriggerRefresh } from "@/lib/refresh-context"
import type { AdjustmentAudit, AdjustmentConfig, AdjustmentPreview } from "@/lib/api-types"

const blockerLabels: Record<string, string> = {
  remote_group_name_missing: "远端分组缺少名称",
  remote_group_inactive: "远端分组未启用",
  no_change: "新倍率与当前倍率相同",
}

const stages = [
  { title: "选择目标", description: "确认要写入的 Sub2API", icon: Target },
  { title: "选择分组", description: "读取远端当前倍率", icon: Layers3 },
  { title: "生成预览", description: "核对影响范围和漂移", icon: Eye },
  { title: "确认并回读", description: "执行后保留审计记录", icon: CheckCircle2 },
]

function fmt(value: number) {
  return Number(value.toFixed(9)).toString()
}

function configGrossMargin(config: AdjustmentConfig) {
  return config.gross_margin_pct ?? config.profit_margin_pct ?? 0
}

function AdjustmentStageRail({ current }: { current: number }) {
  return (
    <div className="grid gap-2 sm:grid-cols-4" aria-label="倍率调整步骤">
      {stages.map((stage, index) => {
        const Icon = stage.icon
        const complete = index < current
        const active = index === current
        return (
          <div
            key={stage.title}
            className={[
              "flex min-w-0 items-start gap-2 rounded-md border px-3 py-2.5",
              active
                ? "border-primary/40 bg-primary/5"
                : complete
                  ? "border-success/30 bg-success/5"
                  : "border-border bg-card",
            ].join(" ")}
          >
            <span className={[
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
              active
                ? "bg-primary text-primary-foreground"
                : complete
                  ? "bg-success/15 text-success"
                  : "bg-muted text-muted-foreground",
            ].join(" ")}>
              {complete ? <CheckCircle2 className="size-3.5" /> : <Icon className="size-3.5" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-foreground">{index + 1}. {stage.title}</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{stage.description}</span>
            </span>
            {index < stages.length - 1 ? <ArrowRight className="ml-auto mt-2 hidden size-3 shrink-0 text-muted-foreground sm:block" /> : null}
          </div>
        )
      })}
    </div>
  )
}

export default function AdjustmentsPage() {
  const refresh = useTriggerRefresh()
  const targets = useAdjustmentTargets()
  const audits = useAdjustmentAudits()
  const adjustmentConfig = useAdjustmentConfig()
  const [targetID, setTargetID] = useState<number | null>(null)
  const groups = useAdjustmentGroups(targetID)
  const [groupID, setGroupID] = useState<number | null>(null)
  const [newRatio, setNewRatio] = useState("")
  const [preview, setPreview] = useState<AdjustmentPreview | null>(null)
  const [confirming, setConfirming] = useState<AdjustmentPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [grossMarginPct, setGrossMarginPct] = useState("")
  const [savingGrossMargin, setSavingGrossMargin] = useState(false)
  const grossMarginHydrated = useRef(false)
  const newRatioManual = useRef(false)
  const previewAbort = useRef<AbortController | null>(null)
  const availableGroups = useMemo(
    () => (groups.data ?? []).filter((group) => group.target_id === targetID),
    [groups.data, targetID],
  )
  const selectedTarget = useMemo(
    () => targets.data?.find((target) => target.id === targetID) ?? null,
    [targetID, targets.data],
  )
  const selectedGroup = useMemo(
    () => groups.data?.find((group) => group.target_id === targetID && group.remote_group_id === groupID) ?? null,
    [groupID, groups.data, targetID],
  )
  const parsedGrossMarginPct = grossMarginPct.trim() === "" ? Number.NaN : Number(grossMarginPct)
  const validGrossMargin = Number.isFinite(parsedGrossMarginPct) && parsedGrossMarginPct >= 0 && parsedGrossMarginPct < 100
  const grossMarginFactor = validGrossMargin ? 1 / (1 - parsedGrossMarginPct / 100) : null
  const suggestedRatio = selectedGroup && validGrossMargin
    ? calculateGrossMarginAdjustedRatio(selectedGroup.ratio, parsedGrossMarginPct)
    : null
  const currentStage = confirming ? 3 : preview ? 2 : groupID != null ? 1 : targetID != null ? 0 : 0

  useEffect(() => {
    if (adjustmentConfig.data && !grossMarginHydrated.current) {
      setGrossMarginPct(fmt(configGrossMargin(adjustmentConfig.data)))
      grossMarginHydrated.current = true
    }
  }, [adjustmentConfig.data])

  useEffect(() => {
    if (newRatioManual.current) return
    setNewRatio(suggestedRatio == null ? "" : fmt(suggestedRatio))
    setPreview(null)
  }, [suggestedRatio])

  useEffect(() => {
    if (targetID == null && targets.data?.length) {
      setTargetID(targets.data.find((target) => target.enabled)?.id ?? targets.data[0].id)
    }
  }, [targetID, targets.data])

  useEffect(() => {
    cancelPreview()
    setGroupID(null)
    setPreview(null)
  }, [targetID])

  useEffect(() => {
    if (groupID == null && availableGroups.length) setGroupID(availableGroups[0].remote_group_id)
  }, [availableGroups, groupID])

  function cancelPreview() {
    previewAbort.current?.abort()
    previewAbort.current = null
    setPreviewing(false)
  }

  function adoptSuggestedRatio() {
    if (suggestedRatio == null) return
    newRatioManual.current = false
    cancelPreview()
    setNewRatio(fmt(suggestedRatio))
    setPreview(null)
  }

  async function saveGrossMargin() {
    if (!validGrossMargin) {
      toast.error("毛利率必须在 0% 到 100% 之间")
      return
    }
    setSavingGrossMargin(true)
    try {
      const saved = await apiFetch<AdjustmentConfig>("/adjustments/config", {
        method: "PUT",
        body: JSON.stringify({ gross_margin_pct: parsedGrossMarginPct }),
      })
      adjustmentConfig.setData(saved)
      setGrossMarginPct(fmt(configGrossMargin(saved)))
      toast.success("目标毛利率已保存")
    } catch (error) {
      toast.error((error as Error).message || "保存毛利率失败")
    } finally {
      setSavingGrossMargin(false)
    }
  }

  async function generatePreview() {
    const ratio = Number(newRatio)
    if (targetID == null || groupID == null || !Number.isFinite(ratio) || ratio <= 0) {
      toast.error("请选择目标分组并输入大于 0 的倍率")
      return
    }
    cancelPreview()
    const controller = new AbortController()
    previewAbort.current = controller
    setPreviewing(true)
    setPreview(null)
    try {
      const result = await apiFetch<AdjustmentPreview>("/adjustments/preview", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ target_id: targetID, remote_group_id: groupID, new_ratio: ratio }),
      })
      setPreview(result)
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error((error as Error).message || "生成预览失败")
    } finally {
      if (previewAbort.current === controller) {
        previewAbort.current = null
        setPreviewing(false)
      }
    }
  }

  async function openRollback(audit: AdjustmentAudit) {
    cancelPreview()
    const controller = new AbortController()
    previewAbort.current = controller
    setPreviewing(true)
    try {
      const result = await apiFetch<AdjustmentPreview>(`/adjustments/audits/${audit.id}/rollback-preview`, { signal: controller.signal })
      setPreview(result)
      setConfirming(result)
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error((error as Error).message)
    } finally {
      if (previewAbort.current === controller) {
        previewAbort.current = null
        setPreviewing(false)
      }
    }
  }

  async function executeConfirmed() {
    if (!confirming) return
    setExecuting(true)
    try {
      const result = confirming.action === "rollback"
        ? await apiFetch<AdjustmentAudit>("/adjustments/rollback", {
            method: "POST",
            body: JSON.stringify({ audit_id: confirming.source_audit_id, expected_current_ratio: confirming.before_ratio, confirm: true }),
          })
        : await apiFetch<AdjustmentAudit>("/adjustments/execute", {
            method: "POST",
            body: JSON.stringify({ target_id: confirming.target_id, remote_group_id: confirming.remote_group_id, expected_group_name: confirming.group_name, expected_current_ratio: confirming.before_ratio, new_ratio: confirming.after_ratio, confirm: true }),
          })
      toast.success(`${confirming.action === "rollback" ? "回滚" : "调价"}成功，审计 ID ${result.id}`)
      if (result.notification_error) toast.warning(`通知发送失败：${result.notification_error}`)
      setConfirming(null)
      setPreview(null)
      setNewRatio("")
      refresh()
    } catch (error) {
      toast.error((error as Error).message || "执行失败")
      refresh()
    } finally {
      setExecuting(false)
    }
  }

  return (
    <section className="min-w-0 space-y-5">
      <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">远端倍率变更需要二次确认</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">本页只会先读取事实并生成预览；执行前会再次校验分组名称和当前倍率。</p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to="/relay">先配置上游</Link>
        </Button>
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">变更工作区</p>
            <h2 className="text-base font-semibold text-foreground">按步骤调整远端分组倍率</h2>
          </div>
          <Badge variant="outline">当前阶段 {currentStage + 1} / {stages.length}</Badge>
        </div>
        <AdjustmentStageRail current={currentStage} />

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(24rem,30rem)_minmax(0,1fr)]">
          <Card className="min-w-0 gap-0">
            <CardHeader className="border-b border-border/70 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><Target className="size-4 text-primary" />选择变更目标</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">先选 Sub2API，再选要调整的远端分组。</p>
                </div>
                {selectedTarget ? <StatusBadge status={selectedTarget.enabled ? "enabled" : "disabled"} /> : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pb-4 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="adjustment-target">目标 Sub2API</Label>
                  <Select value={targetID?.toString() ?? ""} onValueChange={(value) => { newRatioManual.current = false; setTargetID(Number(value)) }}>
                    <SelectTrigger id="adjustment-target" className="w-full"><SelectValue placeholder="选择同步目标" /></SelectTrigger>
                    <SelectContent>
                      {(targets.data ?? []).map((target) => <SelectItem key={target.id} value={String(target.id)} disabled={!target.enabled}>{target.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {selectedTarget ? <p className="text-[11px] text-muted-foreground">{selectedTarget.enabled ? "目标已启用，可读取远端分组" : "目标已停用，请先修复连接"}</p> : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="adjustment-group">远端分组</Label>
                  <Select value={groupID?.toString() ?? ""} onValueChange={(value) => { newRatioManual.current = false; cancelPreview(); setGroupID(Number(value)); setPreview(null) }}>
                    <SelectTrigger id="adjustment-group" className="w-full"><SelectValue placeholder="选择远端分组" /></SelectTrigger>
                    <SelectContent>{availableGroups.map((group) => <SelectItem key={group.id} value={String(group.remote_group_id)}>{group.name} · {fmt(group.ratio)}</SelectItem>)}</SelectContent>
                  </Select>
                  {selectedGroup ? (
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted-foreground">当前远端倍率</p>
                        <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{fmt(selectedGroup.ratio)}</p>
                      </div>
                      <StatusBadge status={selectedGroup.status || "unknown"} />
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-2.5">
                <div className="flex items-start gap-2">
                  <Percent className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-4 text-foreground">目标毛利率</p>
                    <p className="mt-0.5 text-[10px] leading-3.5 text-muted-foreground">建议倍率 = 当前倍率 ÷ (1 - 毛利率)，修改后新倍率会自动同步。</p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="gross-margin">毛利率 (%)</Label>
                    <Input
                      id="gross-margin"
                      type="number"
                      min="0"
                      max="99.99"
                      step="0.01"
                      value={grossMarginPct}
                      onChange={(event) => { newRatioManual.current = false; setGrossMarginPct(event.target.value) }}
                      placeholder={adjustmentConfig.loading ? "正在读取" : "例如 20"}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-1.5 sm:w-auto"
                    disabled={savingGrossMargin || !validGrossMargin}
                    onClick={() => void saveGrossMargin()}
                  >
                    {savingGrossMargin ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    保存毛利率
                  </Button>
                </div>
                <div className="flex flex-col gap-2 border-t border-primary/15 pt-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] text-muted-foreground">建议新倍率</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                      {suggestedRatio == null ? "--" : fmt(suggestedRatio)}
                      {grossMarginFactor != null ? <span className="ml-2 text-xs font-normal text-muted-foreground">× {fmt(grossMarginFactor)}</span> : null}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={suggestedRatio == null}
                    onClick={adoptSuggestedRatio}
                  >
                    采用建议倍率
                  </Button>
                </div>
              </div>
              <div className="space-y-2 rounded-md border border-border/80 bg-muted/20 p-3">
                <div className="space-y-1">
                  <Label htmlFor="new-ratio">新倍率</Label>
                  <Input id="new-ratio" type="number" min="0.000001" step="0.000001" value={newRatio} onChange={(event) => { newRatioManual.current = true; cancelPreview(); setNewRatio(event.target.value); setPreview(null) }} placeholder="根据毛利率自动计算" />
                  <p className="text-[11px] text-muted-foreground">修改毛利率会自动更新；也可以手工覆盖。这里只生成预览，不会立即写入远端。</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="w-full gap-1.5 sm:w-auto" disabled={previewing || !selectedTarget?.enabled} onClick={() => void generatePreview()}>
                  {previewing ? <Loader2 className="size-3.5 animate-spin" /> : <Scale className="size-3.5" />}
                  {previewing ? "正在读取远端" : "生成预览"}
                </Button>
                {previewing ? <Button variant="outline" className="w-full gap-1.5 sm:w-auto" onClick={cancelPreview}><X className="size-3.5" />取消</Button> : null}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 gap-0">
            <CardHeader className="border-b border-border/70 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><Eye className="size-4 text-primary" />检查变更影响</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">预览会显示远端实时值、变更幅度和阻断原因。</p>
                </div>
                <Badge variant={preview?.executable ? "secondary" : "outline"}>{preview ? (preview.executable ? "可执行" : "需要处理") : "等待预览"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {!preview ? (
                <div className="flex min-h-52 flex-col items-center justify-center px-4 py-6 text-center">
                  <CircleDashed className="size-7 text-muted-foreground/60" />
                  <p className="mt-3 text-sm font-medium text-foreground">还没有变更预览</p>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">完成左侧三项选择后，点击“生成变更预览”。系统会先读取远端，不会直接执行。</p>
                  <div className="mt-4 grid w-full max-w-md gap-2 text-left sm:grid-cols-3">
                    <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">1.</span> 校验目标</div>
                    <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">2.</span> 读取倍率</div>
                    <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">3.</span> 计算影响</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-md border border-border bg-muted/20 px-3 py-2"><p className="text-[11px] text-muted-foreground">目标 / 分组</p><p className="mt-1 truncate text-sm font-medium" title={`${preview.target_name} / ${preview.group_name}`}>{preview.target_name} / {preview.group_name}</p></div>
                    <div className="rounded-md border border-border bg-muted/20 px-3 py-2"><p className="text-[11px] text-muted-foreground">倍率变化</p><p className="mt-1 text-sm font-medium">{fmt(preview.before_ratio)} → {fmt(preview.after_ratio)}</p></div>
                    <div className="rounded-md border border-border bg-muted/20 px-3 py-2"><p className="text-[11px] text-muted-foreground">相对变化</p><p className="mt-1 text-sm font-medium">{preview.change_percent > 0 ? "+" : ""}{preview.change_percent.toFixed(2)}%</p></div>
                  </div>
                  <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm"><span className="font-medium text-foreground">影响范围：</span><span className="text-muted-foreground">{preview.impact_scope}</span></div>
                  {preview.blockers.length ? <div className="flex flex-wrap gap-1.5">{preview.blockers.map((code) => <Badge key={code} variant="destructive">{blockerLabels[code] ?? code}</Badge>)}</div> : <p className="text-xs text-success">未发现阻断条件，可以进入二次确认。</p>}
                  <div className="flex flex-col gap-3 border-t border-border/70 pt-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-[11px] text-muted-foreground">远端读取于 {dateTime(preview.generated_at)}</p><Button className="w-full sm:w-auto" disabled={!preview.executable} onClick={() => setConfirming(preview)}>{preview.action === "rollback" ? "确认回滚" : "进入二次确认"}</Button></div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <Card className="min-w-0 gap-0 overflow-hidden">
        <CardHeader className="border-b border-border/70 pb-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div><CardTitle className="flex items-center gap-2 text-base"><History className="size-4 text-primary" />执行审计</CardTitle><p className="mt-1 text-xs text-muted-foreground">每次执行、失败或回滚都会保留结果，便于回读和再次预览。</p></div>
            <Badge variant="outline">{audits.data?.length ?? 0} 条记录</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(audits.data ?? []).length === 0 ? <EmptyState title="暂无倍率调整记录" description="生成预览并完成一次执行后，审计结果会显示在这里。" /> : (
            <div className="overflow-x-auto">
              <table className="min-w-[780px] w-full text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-4 py-2.5 font-medium">ID / 时间</th><th className="px-3 py-2.5 font-medium">动作</th><th className="px-3 py-2.5 font-medium">目标分组</th><th className="px-3 py-2.5 font-medium">倍率</th><th className="px-3 py-2.5 font-medium">状态</th><th className="px-3 py-2.5 font-medium">操作者</th><th className="px-3 py-2.5 font-medium">操作</th></tr></thead>
                <tbody>{(audits.data ?? []).map((audit) => <tr key={audit.id} className="border-t border-border/70 align-top"><td className="whitespace-nowrap px-4 py-3"><div className="font-medium">#{audit.id}</div><div className="text-muted-foreground" title={dateTime(audit.created_at)}>{relativeTime(audit.created_at)}</div></td><td className="px-3 py-3">{audit.action === "rollback" ? "回滚" : "调价"}{audit.source_audit_id ? <div className="text-muted-foreground">来源 #{audit.source_audit_id}</div> : null}</td><td className="px-3 py-3"><div>{audit.target_name}</div><div className="text-muted-foreground">{audit.group_name} (#{audit.remote_group_id})</div></td><td className="whitespace-nowrap px-3 py-3">{fmt(audit.before_ratio)} → {fmt(audit.after_ratio)}</td><td className="max-w-xs px-3 py-3"><StatusBadge status={audit.status} />{audit.error_message ? <p className="mt-1 break-words text-destructive">{audit.error_message}</p> : null}{audit.notification_error ? <p className="mt-1 break-words text-amber-700 dark:text-amber-300">通知失败：{audit.notification_error}</p> : null}</td><td className="px-3 py-3">{audit.operator}</td><td className="px-3 py-3"><Button size="sm" variant="outline" className="gap-1" disabled={!( ["succeeded", "uncertain"] as string[]).includes(audit.status) || previewing} onClick={() => void openRollback(audit)}><RotateCcw className="size-3.5" />回滚预览</Button></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && !executing && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{confirming?.action === "rollback" ? "二次确认回滚" : "二次确认调价"}</AlertDialogTitle><AlertDialogDescription>系统会再次读取远端分组并核验名称和当前倍率，任何漂移都会拒绝执行。</AlertDialogDescription></AlertDialogHeader>
          {confirming ? <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-sm"><div className="flex items-start gap-2"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-700" /><span>{confirming.target_name} / {confirming.group_name}</span></div><p className="font-medium">{fmt(confirming.before_ratio)} → {fmt(confirming.after_ratio)}</p><p className="text-xs text-muted-foreground">{confirming.impact_scope}</p></div> : null}
          <AlertDialogFooter><AlertDialogCancel disabled={executing}>取消</AlertDialogCancel><AlertDialogAction disabled={executing} onClick={() => void executeConfirmed()}>{executing ? <><Loader2 className="mr-1 size-3.5 animate-spin" />执行中</> : confirming?.action === "rollback" ? <><RotateCcw className="mr-1 size-3.5" />确认回滚</> : <><Scale className="mr-1 size-3.5" />确认执行</>}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
