"use client"

import { useEffect, useMemo, useState } from "react"
import { Bot, CheckCircle2, Copy, Link2, RefreshCw, ShieldAlert, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { apiFetch } from "@/lib/api"
import type { FeishuBindingCode } from "@/lib/api-types"
import { useFeishuControlStatus } from "@/lib/queries"

export function FeishuBindingCard() {
  const status = useFeishuControlStatus()
  const { confirm, dialog } = useConfirm()
  const [bindingCode, setBindingCode] = useState<FeishuBindingCode | null>(null)
  const [busy, setBusy] = useState<"generate" | "unbind" | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!bindingCode) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [bindingCode])

  const remainingSeconds = bindingCode
    ? Math.max(0, Math.ceil((new Date(bindingCode.expires_at).getTime() - now) / 1000))
    : 0
  const callbackURL = useMemo(() => {
    const path = status.data?.callback_path || "/callbacks/feishu"
    if (typeof window === "undefined") return path
    return `${window.location.origin}${path}`
  }, [status.data?.callback_path])

  async function generateCode() {
    setBusy("generate")
    try {
      const result = await apiFetch<FeishuBindingCode>("/feishu/binding-code", {
        method: "POST",
      })
      setBindingCode(result)
      setNow(Date.now())
      toast.success("一次性绑定码已生成")
      status.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成绑定码失败")
    } finally {
      setBusy(null)
    }
  }

  async function copyText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(message)
    } catch {
      toast.error("复制失败，请手动选择文本")
    }
  }

  async function unbind() {
    const ok = await confirm({
      title: "解除飞书批准账号绑定？",
      description: "解除后，当前账号将不能批准容灾操作；所有未使用绑定码也会立即失效。",
      confirmLabel: "解除绑定",
      destructive: true,
    })
    if (!ok) return
    setBusy("unbind")
    try {
      await apiFetch("/feishu/binding", { method: "DELETE" })
      setBindingCode(null)
      status.refetch()
      toast.success("飞书账号绑定已解除")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "解除绑定失败")
    } finally {
      setBusy(null)
    }
  }

  const configured = status.data?.configured ?? false
  const enabled = status.data?.enabled ?? false
  const bound = status.data?.bound ?? false
  const encryptionConfigured = status.data?.encryption_configured ?? false
  const adminAuthEnabled = status.data?.admin_auth_enabled ?? false
  const bindCodeTTLMinutes = status.data?.bind_code_ttl_minutes ?? 10
  const bindCodeMaxAttempts = status.data?.bind_code_max_attempts ?? 5
  const canManageBinding = enabled && configured && adminAuthEnabled && busy === null

  return (
    <>
      <Card className="border border-border shadow-none">
        <CardHeader className="gap-3 border-b border-border bg-muted/20 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Bot className="size-5 text-blue-600" />
                <CardTitle className="text-base font-semibold">飞书控制通道</CardTitle>
              </div>
              <CardDescription className="max-w-3xl leading-6">
                绑定唯一批准人的飞书 open_id。当前阶段只验证回调、私聊和卡片身份，不会执行数据库接管、服务器关机或 DNS 修改。
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}>
                {enabled ? "通道已启用" : "通道未启用"}
              </Badge>
              <Badge variant="outline" className={bound ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-background text-muted-foreground"}>
                {bound ? "批准账号已绑定" : "尚未绑定"}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-6 py-4">
          {status.loading ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
              正在读取飞书控制状态…
            </div>
          ) : status.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {status.error}
            </div>
          ) : (
            <>
              <div className="grid gap-3 xl:grid-cols-4">
                <StatusTile
                  title="应用凭据"
                  value={configured ? "配置完整" : "配置不完整"}
                  ok={configured}
                  hint="App ID、App Secret、Verification Token"
                />
                <StatusTile
                  title="回调加密"
                  value={encryptionConfigured ? "Encrypt Key 已配置" : "未配置 Encrypt Key"}
                  ok={encryptionConfigured}
                  hint="生产环境必须开启签名校验与加密"
                />
                <StatusTile
                  title="后台鉴权"
                  value={adminAuthEnabled ? "管理员鉴权已开启" : "管理员鉴权未开启"}
                  ok={adminAuthEnabled}
                  hint="生成或解除绑定必须先登录后台"
                />
                <StatusTile
                  title="批准账号"
                  value={bound ? status.data?.bound_open_id_masked || "已绑定" : "未绑定"}
                  ok={bound}
                  hint={status.data?.bound_at ? `绑定时间 ${new Date(status.data.bound_at).toLocaleString()}` : "只允许一个精确 open_id"}
                />
              </div>

              <section className="space-y-3 rounded-md border border-border bg-background/80 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Link2 className="size-4 text-blue-600" />
                  飞书事件回调地址
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground">
                    {callbackURL}
                  </code>
                  <Button variant="outline" size="sm" onClick={() => copyText(callbackURL, "回调地址已复制")}>
                    <Copy className="size-3.5" />
                    复制
                  </Button>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  后端部署并通过 challenge 验证后，再到飞书开放平台保存该地址并发布应用。
                </p>
              </section>

              {!enabled || !configured || !adminAuthEnabled ? (
                <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                  <p className="leading-6">
                    请先通过 secret-file 配置飞书凭据、开启后台管理员鉴权并重启本控制台。配置不完整时，回调固定返回 JSON 503；管理员鉴权未开启时，生成和解除绑定接口会拒绝执行。
                  </p>
                </div>
              ) : null}

              {bound ? (
                <div className="flex flex-col gap-3 rounded-md border border-emerald-200 bg-emerald-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-900">唯一批准账号已锁定</p>
                      <p className="mt-1 text-xs leading-5 text-emerald-800">
                        卡片动作必须来自该 open_id。显示名、手机号和群聊身份都不能替代该校验。
                      </p>
                    </div>
                  </div>
                  <Button variant="destructive" size="sm" disabled={busy !== null} onClick={unbind}>
                    <Trash2 className="size-3.5" />
                    {busy === "unbind" ? "解除中…" : "解除绑定"}
                  </Button>
                </div>
              ) : (
                <section className="rounded-md border border-border bg-muted/20 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">一次性绑定码</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        有效期 {bindCodeTTLMinutes} 分钟、最多尝试 {bindCodeMaxAttempts} 次、单次使用；数据库只保存 HMAC 摘要。
                      </p>
                    </div>
                    <Button size="sm" disabled={!canManageBinding} onClick={generateCode}>
                      <RefreshCw className={busy === "generate" ? "size-3.5 animate-spin" : "size-3.5"} />
                      {busy === "generate" ? "生成中…" : "生成绑定码"}
                    </Button>
                  </div>

                  {bindingCode ? (
                    <div className="mt-4 space-y-3 rounded-md border border-blue-200 bg-blue-50/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <code className="text-2xl font-semibold tracking-[0.18em] text-blue-950">{bindingCode.code}</code>
                        <Badge variant="outline" className={remainingSeconds > 0 ? "border-blue-200 bg-white text-blue-700" : "border-destructive/30 bg-destructive/5 text-destructive"}>
                          {remainingSeconds > 0 ? `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")} 后过期` : "已过期"}
                        </Badge>
                      </div>
                      <p className="text-sm leading-6 text-blue-950">
                        私聊机器人发送：<strong>{bindingCode.command}</strong>
                      </p>
                      <Button variant="outline" size="sm" onClick={() => copyText(bindingCode.command, "绑定命令已复制")}>
                        <Copy className="size-3.5" />
                        复制绑定命令
                      </Button>
                    </div>
                  ) : null}
                </section>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {dialog}
    </>
  )
}

function StatusTile({ title, value, hint, ok }: { title: string; value: string; hint: string; ok: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background/80 px-4 py-3">
      <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
      <p className={ok ? "mt-2 text-sm font-semibold text-emerald-700" : "mt-2 text-sm font-semibold text-amber-800"}>{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p>
    </div>
  )
}
