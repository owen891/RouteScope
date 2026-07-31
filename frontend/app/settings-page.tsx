import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  HardDrive,
  Bell,
  Clock3,
  KeyRound,
  MonitorCog,
  Network,
  PencilLine,
  Plus,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CaptchaFormDialog } from "@/components/monitor/captcha-form-dialog";
import { NotificationFormDialog } from "@/components/monitor/notification-form-dialog";
import { apiDownload, apiFetch } from "@/lib/api";
import { useTriggerRefresh } from "@/lib/refresh-context";
import type {
  AppVersion,
  ApplyConfigResult,
  CaptchaConfig,
  NotificationChannel,
  NotificationChannelType,
  SystemConfig,
  SystemConfigInput,
  SystemGatewayConfig,
  WebBackupItem,
  WebBackupListResponse,
  WebBackupRestoreResult,
} from "@/lib/api-types";
import { decimal, money, relativeTime } from "@/lib/format";
import {
  useCaptchaConfigs,
  useNotificationLogs,
  useNotificationChannels,
  useAppVersion,
  useSystemConfig,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { formatNotifyTestError } from "@/lib/notify-test-error";
import { publishProductTitle } from "@/lib/product-brand";

function num(v: string) {
  return Number(v || 0);
}

function formatBackupSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

const defaultGatewayConfig: SystemGatewayConfig = {
  tempPauseSeconds: 30,
  forwardTimeoutSeconds: 600,
  modelsCacheTTLSeconds: 60,
  maxFailoverSwitches: 8,
  routeBatchConcurrency: 8,
  usageErrorBodyBytes: 32768,
  usageErrorMsgRunes: 500,
  usageErrorHeaderValueRunes: 8192,
  usageErrorHeadersJSONBytes: 65536,
};

function patchGateway(
  prev: SystemConfigForm | null,
  key: keyof SystemGatewayConfig,
  value: number,
): SystemConfigForm | null {
  if (!prev) return prev;
  return {
    ...prev,
    gateway: {
      ...(prev.gateway ?? defaultGatewayConfig),
      [key]: value,
    },
  };
}

function createSystemConfigForm(cfg: SystemConfig): SystemConfigForm {
  return {
    ...cfg,
    auth: {
      ...cfg.auth,
      passwordReplacement: "",
      tokenSecretReplacement: "",
    },
    proxy: {
      ...cfg.proxy,
      passwordReplacement: "",
    },
    gateway: { ...defaultGatewayConfig, ...(cfg.gateway ?? {}) },
  };
}

function formsEqual(a: SystemConfigForm, b: SystemConfigForm) {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface ProxyTestResult {
  ok: boolean;
  latency_ms: number;
  ip: string;
  provider: string;
  error?: string;
}

type SystemConfigForm = Omit<SystemConfig, "auth" | "proxy"> & {
  auth: SystemConfig["auth"] & {
    passwordReplacement: string;
    tokenSecretReplacement: string;
  };
  proxy: SystemConfig["proxy"] & {
    passwordReplacement: string;
  };
};

export default function SettingsPage() {
  const query = useSystemConfig();
  const notifications = useNotificationChannels();
  const captchas = useCaptchaConfigs();
  const notificationLogs = useNotificationLogs(1, 10);
  const appVersion = useAppVersion();
  const refresh = useTriggerRefresh();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [form, setForm] = useState<SystemConfigForm | null>(null);
  const formRef = useRef<SystemConfigForm | null>(null);
  const formBaselineRef = useRef<SystemConfigForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [configSavedPendingApply, setConfigSavedPendingApply] = useState(false);
  const [editingNotification, setEditingNotification] =
    useState<NotificationChannel | null>(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [editingCaptcha, setEditingCaptcha] = useState<CaptchaConfig | null>(
    null,
  );
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [busyNotificationID, setBusyNotificationID] = useState<number | null>(
    null,
  );
  const [busyCaptchaID, setBusyCaptchaID] = useState<number | null>(null);
  const [testingProxy, setTestingProxy] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [settingsTab, setSettingsTab] = useState("runtime");
  const [versionInfo, setVersionInfo] = useState<AppVersion | null>(null);
  const [anonProbe, setAnonProbe] = useState<
    "unknown" | "open" | "protected" | "error"
  >("unknown");
  const [probingAnon, setProbingAnon] = useState(false);
  const [backups, setBackups] = useState<WebBackupItem[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoredMessage, setRestoredMessage] = useState<string | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    if (!query.data?.config) return;

    const nextForm = createSystemConfigForm(query.data.config);
    const currentForm = formRef.current;
    const baseline = formBaselineRef.current;
    if (currentForm && baseline && !formsEqual(currentForm, baseline)) {
      return;
    }

    formBaselineRef.current = nextForm;
    formRef.current = nextForm;
    setForm(nextForm);
  }, [query.data]);

  useEffect(() => {
    if (appVersion.data) {
      setVersionInfo(appVersion.data);
    }
  }, [appVersion.data]);

  async function probeAnonymousAccess() {
    setProbingAnon(true);
    try {
      // Intentionally omit Authorization to detect real API protection.
      const res = await fetch("/api/channels", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (res.status === 401) setAnonProbe("protected");
      else if (res.ok) setAnonProbe("open");
      else setAnonProbe("error");
    } catch {
      setAnonProbe("error");
    } finally {
      setProbingAnon(false);
    }
  }

  useEffect(() => {
    void probeAnonymousAccess();
  }, []);

  async function refreshBackups() {
    setBackupsLoading(true);
    try {
      const result = await apiFetch<WebBackupListResponse>("/settings/backups");
      setBackups(result.items ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载备份列表失败");
    } finally {
      setBackupsLoading(false);
    }
  }

  async function handleCreateBackup() {
    setBackupBusy(true);
    setRestoredMessage(null);
    try {
      await apiFetch<WebBackupItem>("/settings/backups", { method: "POST" });
      toast.success("Web 备份已创建");
      await refreshBackups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建备份失败");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleDownloadBackup(tag: string) {
    setBackupBusy(true);
    try {
      const blob = await apiDownload(
        `/settings/backups/${encodeURIComponent(tag)}/download`,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `routescope-backup-${tag}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下载备份失败");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestoreBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const ok = await confirm({
      title: "恢复 Web 备份？",
      description:
        "系统会先创建当前数据的安全快照，再校验上传文件并替换数据库与配置。恢复后服务会自动重启。",
      confirmLabel: "确认恢复",
      destructive: true,
    });
    if (!ok) return;
    setBackupBusy(true);
    try {
      const payload = new FormData();
      payload.append("backup", file);
      const result = await apiFetch<WebBackupRestoreResult>(
        "/settings/backups/restore",
        { method: "POST", body: payload },
      );
      setRestoredMessage(
        `${result.message} 恢复前安全快照：${result.safety_backup}`,
      );
      toast.success("备份已恢复，服务正在重启");
      await refreshBackups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复备份失败");
    } finally {
      setBackupBusy(false);
    }
  }

  useEffect(() => {
    void refreshBackups();
  }, []);

  if (query.loading && !form) {
    return (
      <section className="text-sm text-muted-foreground">加载配置中...</section>
    );
  }

  if (query.error && !form) {
    return (
      <section className="text-sm text-destructive">{query.error}</section>
    );
  }

  if (!form) return null;

  const authEnvironmentOverrides = form.auth.environmentOverrides ?? [];
  const recentLogs = notificationLogs.data?.items ?? [];
  const lastSent = recentLogs[0]?.sent_at ?? null;
  const recentFailed = recentLogs.filter((item) => !item.success).length;

  async function handleDeleteNotification(channel: NotificationChannel) {
    const ok = await confirm({
      title: `删除通知渠道 ${channel.name}？`,
      description: "删除后该渠道将不再接收系统通知。",
      confirmLabel: "删除",
      destructive: true,
    });
    if (!ok) return;
    setBusyNotificationID(channel.id);
    try {
      await apiFetch(`/notifications/channels/${channel.id}`, {
        method: "DELETE",
      });
      toast.success(`已删除 ${channel.name}`);
      refresh();
      notifications.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyNotificationID(null);
    }
  }

  async function handleTestNotification(channel: NotificationChannel) {
    setBusyNotificationID(channel.id);
    try {
      const res = await apiFetch<{ ok: boolean; error?: string }>(
        `/notifications/channels/${channel.id}/test`,
        { method: "POST" },
      );
      if (res.ok) {
        toast.success(`已发送测试消息到 ${channel.name}`);
      } else {
        toast.error(
          formatNotifyTestError(channel.type, res.error ?? "测试失败"),
        );
      }
      refresh();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "测试失败";
      toast.error(formatNotifyTestError(channel.type, raw));
    } finally {
      setBusyNotificationID(null);
    }
  }

  async function handleDeleteCaptcha(item: CaptchaConfig) {
    const ok = await confirm({
      title: `删除验证码服务 ${item.name}？`,
      description: "删除后引用此服务的渠道需要重新指定验证码服务。",
      confirmLabel: "删除",
      destructive: true,
    });
    if (!ok) return;
    setBusyCaptchaID(item.id);
    try {
      await apiFetch(`/captcha-configs/${item.id}`, { method: "DELETE" });
      toast.success(`已删除 ${item.name}`);
      refresh();
      captchas.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyCaptchaID(null);
    }
  }

  async function handleRefreshCaptchaBalance(item: CaptchaConfig) {
    setBusyCaptchaID(item.id);
    try {
      await apiFetch(`/captcha-configs/${item.id}/refresh-balance`, {
        method: "POST",
      });
      toast.success(`已更新 ${item.name} 剩余额度`);
      refresh();
      captchas.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
      refresh();
      captchas.refetch();
    } finally {
      setBusyCaptchaID(null);
    }
  }

  async function handleSave() {
    if (
      form?.auth.enabled &&
      !form.auth.passwordConfigured &&
      !form.auth.passwordReplacement.trim()
    ) {
      toast.warning("已启用鉴权：若是首次开启，请填写管理员密码后再保存")
      return
    }
    if (!form) return;

    const payload: SystemConfigInput = {
      app: form.app,
      auth: {
        enabled: form.auth.enabled,
        username: form.auth.username,
        sessionTTLHours: form.auth.sessionTTLHours,
        ...(form.auth.passwordReplacement.trim()
          ? { passwordReplacement: form.auth.passwordReplacement }
          : {}),
        ...(form.auth.tokenSecretReplacement.trim()
          ? { tokenSecretReplacement: form.auth.tokenSecretReplacement }
          : {}),
      },
      scheduler: form.scheduler,
      notifications: form.notifications,
      proxy: {
        enabled: form.proxy.enabled,
        versionCheckEnabled: form.proxy.versionCheckEnabled,
        protocol: form.proxy.protocol,
        host: form.proxy.host,
        port: form.proxy.port,
        username: form.proxy.username,
        ...(form.proxy.passwordReplacement.trim()
          ? { passwordReplacement: form.proxy.passwordReplacement }
          : {}),
      },
      upstream: form.upstream,
      gateway: form.gateway,
    };
    setSaving(true);
    try {
      await apiFetch("/settings/config", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const savedForm: SystemConfigForm = {
        ...form,
        auth: {
          ...form.auth,
          passwordReplacement: "",
          tokenSecretReplacement: "",
        },
        proxy: { ...form.proxy, passwordReplacement: "" },
      };
      formBaselineRef.current = savedForm;
      formRef.current = savedForm;
      setForm(savedForm);
      toast.success("已写入配置文件");
      publishProductTitle(payload.app.title);
      setConfigSavedPendingApply(true);
      query.refetch();
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleApply() {
    setApplying(true);
    try {
      const result = await apiFetch<ApplyConfigResult>("/settings/apply", {
        method: "POST",
      });
      toast.success(result.message);
      setConfigSavedPendingApply(false);
      query.refetch();
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "应用失败");
    } finally {
      setApplying(false);
    }
  }

  async function handleTestProxy() {
    setTestingProxy(true);
    try {
      const result = await apiFetch<ProxyTestResult>("/settings/proxy/test", {
        method: "POST",
        body: JSON.stringify(
          form
            ? {
                enabled: form.proxy.enabled,
                versionCheckEnabled: form.proxy.versionCheckEnabled,
                protocol: form.proxy.protocol,
                host: form.proxy.host,
                port: form.proxy.port,
                username: form.proxy.username,
                password: form.proxy.passwordReplacement,
              }
            : {},
        ),
      });
      if (result.ok) {
        toast.success(
          `代理可用，出口 IP ${result.ip}，延迟 ${result.latency_ms}ms`,
        );
      } else {
        toast.error(result.error ?? "代理测试失败");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "代理测试失败");
    } finally {
      setTestingProxy(false);
    }
  }

  async function handleCheckVersion() {
    setCheckingVersion(true);
    try {
      const result = await apiFetch<AppVersion>("/version?force=1");
      setVersionInfo(result);
      appVersion.setData(result);
      if (result.update_error) {
        toast.error(result.update_error);
      } else if (result.update_available && result.latest_version) {
        toast.warning(`发现新版本 ${result.latest_version}`);
      } else {
        toast.success("当前已是最新版本");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "检测更新失败");
    } finally {
      setCheckingVersion(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="surface-panel grid divide-y divide-border overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <SettingsStatus
          label="访问控制"
          value={form.auth.enabled ? "鉴权已开启" : "鉴权已关闭"}
          tone={form.auth.enabled ? "good" : "warning"}
        />
        <SettingsStatus
          label="运行时配置"
          value={configSavedPendingApply ? "已保存，等待应用" : "配置已同步"}
          tone={configSavedPendingApply ? "warning" : "neutral"}
        />
        <SettingsStatus
          label="配置文件"
          value={query.data?.config_path ?? "未返回路径"}
          mono
        />
      </div>

      <Tabs
        value={settingsTab}
        onValueChange={setSettingsTab}
        className="min-w-0 gap-4"
      >
        <div className="section-toolbar sticky top-14 z-20 flex-col gap-3 bg-card/95 backdrop-blur sm:static sm:flex-row sm:items-center sm:justify-between sm:bg-card sm:backdrop-blur-none">
          <TabsList aria-label="系统设置视图">
            <TabsTrigger value="runtime">运行配置</TabsTrigger>
            <TabsTrigger value="notification-policy">通知策略</TabsTrigger>
            <TabsTrigger value="upstream">上游请求</TabsTrigger>
            <TabsTrigger value="proxy">代理 IP</TabsTrigger>
            <TabsTrigger value="backup">数据备份</TabsTrigger>
          </TabsList>
          <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <p
              className={cn(
                "text-xs leading-5 sm:text-right",
                configSavedPendingApply
                  ? "font-medium text-amber-700"
                  : "text-muted-foreground",
              )}
            >
              {configSavedPendingApply
                ? "配置已保存但尚未应用。"
                : "保存写入配置文件；应用后运行时策略立即更新。"}
            </p>
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
              <Button onClick={handleSave} disabled={saving || applying}>
                {saving ? "保存中..." : "保存"}
              </Button>
              <Button
                variant="outline"
                onClick={handleApply}
                disabled={saving || applying}
              >
                {applying ? "应用中..." : "应用"}
              </Button>
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <TabsContent value="runtime" className="mt-0 min-w-0">
            <div className="space-y-5">
              <SectionCard
                icon={<MonitorCog className="size-4 text-violet-600" />}
                title="应用信息"
                description="控制页面标题和通知标题前缀。"
              >
                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className={cn(
                      "border-transparent",
                      form.auth.enabled
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-800",
                    )}
                  >
                    {form.auth.enabled
                      ? `鉴权已开启 · 用户 ${form.auth.username || "admin"}`
                      : "鉴权已关闭 · 所有 /api 可匿名访问"}
                  </Badge>
                  <Badge variant="outline" className="border-border bg-background">
                    当前版本 {versionInfo?.version || "加载中"}
                  </Badge>
                  {versionInfo?.latest_version ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        "border-transparent",
                        versionInfo.update_available
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700",
                      )}
                    >
                      {versionInfo.update_available
                        ? `可更新 ${versionInfo.latest_version}`
                        : "已是最新"}
                    </Badge>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-border bg-background px-2 text-xs"
                    onClick={handleCheckVersion}
                    disabled={checkingVersion}
                  >
                    <RefreshCw
                      className={cn(
                        "size-3.5",
                        checkingVersion ? "animate-spin" : "",
                      )}
                    />
                    {checkingVersion ? "检测中..." : "检测更新"}
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="应用标题"
                    description="用于顶部标题和浏览器标签标题。"
                  >
                    <Input
                      value={form.app.title}
                      onChange={(e) =>
                        setForm((prev) =>
                          prev
                            ? {
                                ...prev,
                                app: { ...prev.app, title: e.target.value },
                              }
                            : prev,
                        )
                      }
                    />
                  </Field>
                  <Field
                    label="通知前缀"
                    description="为空时通知标题不添加前缀。"
                  >
                    <Input
                      value={form.app.notificationPrefix}
                      onChange={(e) =>
                        setForm((prev) =>
                          prev
                            ? {
                                ...prev,
                                app: {
                                  ...prev.app,
                                  notificationPrefix: e.target.value,
                                },
                              }
                            : prev,
                        )
                      }
                    />
                  </Field>
                </div>
              </SectionCard>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_1fr]">
            <SectionCard
              icon={<ShieldCheck className="size-4 text-emerald-600" />}
              title="登录鉴权"
              description="控制后台是否需要登录，以及登录令牌的签发方式。"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <InlineSwitch
                  id="auth-enabled"
                  label="启用登录鉴权"
                  description="关闭后前端将直接进入系统，不显示登录页。"
                  checked={form.auth.enabled}
                  disabled={authEnvironmentOverrides.includes("enabled")}
                  onCheckedChange={(checked) =>
                    setForm((prev) =>
                      prev
                        ? { ...prev, auth: { ...prev.auth, enabled: checked } }
                        : prev,
                    )
                  }
                />
                {form.auth.enabled ? (
                  <NoteBox title="热应用说明">
                    应用后新的鉴权配置立即生效。请先填写管理员密码再保存并应用；仅改配置文件而容器
                    环境变量 AUTH_ENABLED 未开时，部分部署仍可能匿名访问 API，请以实际登录页为准。
                  </NoteBox>
                ) : (
                  <NoteBox title="安全风险">
                    当前鉴权关闭，所有 /api 可匿名访问。仅建议本机调试；对外暴露前请开启鉴权、设置强密码，并保存后点击「应用」。
                  </NoteBox>
                )}
                {authEnvironmentOverrides.length > 0 ? (
                  <NoteBox title="部署环境接管">
                    当前鉴权字段由环境变量接管：{authEnvironmentOverrides.join(", ")}。修改这些字段请更新部署环境并重建容器；设置页不会把未生效的文件配置当作已应用。
                  </NoteBox>
                ) : null}
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field
                  label="管理员账号"
                  description="用于后台登录的固定账号。"
                >
                  <Input
                    value={form.auth.username}
                    disabled={authEnvironmentOverrides.includes("username")}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              auth: { ...prev.auth, username: e.target.value },
                            }
                          : prev,
                      )
                    }
                  />
                </Field>
                <Field
                  label="登录有效期（小时）"
                  description="登录后令牌的有效时长。"
                >
                  <Input
                    type="number"
                    value={String(form.auth.sessionTTLHours)}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              auth: {
                                ...prev.auth,
                                sessionTTLHours: num(e.target.value),
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </Field>
                <Field
                  label="管理员密码"
                  description={
                    form.auth.passwordConfigured
                      ? "密码已配置；留空保持不变，输入内容仅用于替换。"
                      : "尚未配置密码；启用鉴权前请输入新密码。"
                  }
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={form.auth.passwordReplacement}
                    disabled={authEnvironmentOverrides.includes("password")}
                    placeholder={
                      form.auth.passwordConfigured ? "已配置，留空不变" : "输入新密码"
                    }
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              auth: {
                                ...prev.auth,
                                passwordReplacement: e.target.value,
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </Field>
                <Field
                  label="令牌签名密钥"
                  description={
                    form.auth.tokenSecretConfigured
                      ? "签名密钥已配置；留空保持不变，输入内容仅用于替换。"
                      : "未单独配置时由后端回退到安全主密钥。"
                  }
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={form.auth.tokenSecretReplacement}
                    disabled={authEnvironmentOverrides.includes("tokenSecret")}
                    placeholder={
                      form.auth.tokenSecretConfigured
                        ? "已配置，留空不变"
                        : "可选：输入独立签名密钥"
                    }
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              auth: {
                                ...prev.auth,
                                tokenSecretReplacement: e.target.value,
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </Field>
              </div>
            </SectionCard>

            <SectionCard
              icon={<Clock3 className="size-4 text-sky-600" />}
              title="调度与保留策略"
              description="管理余额采集、倍率采集和历史清理任务。"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="余额采集 Cron"
                  description="控制余额与消费同步的执行周期。"
                >
                  <Input
                    value={form.scheduler.balanceCron}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              scheduler: {
                                ...prev.scheduler,
                                balanceCron: e.target.value,
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </Field>
                <Field
                  label="倍率采集 Cron"
                  description="控制分组倍率扫描的执行周期。"
                >
                  <Input
                    value={form.scheduler.rateCron}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              scheduler: {
                                ...prev.scheduler,
                                rateCron: e.target.value,
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </Field>
                <Field
                  label="并发数"
                  description="调度器每轮最多同时处理的任务数。"
                >
                  <Input
                    type="number"
                    value={String(form.scheduler.concurrency)}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              scheduler: {
                                ...prev.scheduler,
                                concurrency: num(e.target.value),
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </Field>
                <Field
                  label="清理任务 Cron"
                  description="留空则不执行历史数据清理。"
                >
                  <Input
                    value={form.scheduler.retention.cron}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              scheduler: {
                                ...prev.scheduler,
                                retention: {
                                  ...prev.scheduler.retention,
                                  cron: e.target.value,
                                },
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </Field>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <Field
                  label="监控日志保留天数"
                  description="超过该天数的监控日志会被清理。"
                >
                  <Input
                    type="number"
                    value={String(form.scheduler.retention.monitorLogsDays)}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              scheduler: {
                                ...prev.scheduler,
                                retention: {
                                  ...prev.scheduler.retention,
                                  monitorLogsDays: num(e.target.value),
                                },
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </Field>
                <Field
                  label="余额快照保留天数"
                  description="余额与消费趋势依赖这部分历史快照。"
                >
                  <Input
                    type="number"
                    value={String(
                      form.scheduler.retention.balanceSnapshotsDays,
                    )}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              scheduler: {
                                ...prev.scheduler,
                                retention: {
                                  ...prev.scheduler.retention,
                                  balanceSnapshotsDays: num(e.target.value),
                                },
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </Field>
                <Field
                  label="通知日志保留天数"
                  description="通知发送结果的历史留存时长。"
                >
                  <Input
                    type="number"
                    value={String(
                      form.scheduler.retention.notificationLogsDays,
                    )}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              scheduler: {
                                ...prev.scheduler,
                                retention: {
                                  ...prev.scheduler.retention,
                                  notificationLogsDays: num(e.target.value),
                                },
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </Field>
              </div>
            </SectionCard>
          </div>

          </div>
        </TabsContent>

        <TabsContent value="notification-policy" className="mt-0 min-w-0">
          <div className="space-y-5">
          <SectionCard
            icon={<Bell className="size-4 text-amber-600" />}
            title="通知策略"
            description="这些项决定系统怎么合并、过滤和重试通知。"
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <InlineSwitch
                id="batch-rate"
                label="合并倍率变化"
                description="同一次扫描中的多条倍率变化合并发送。"
                checked={form.notifications.batchRateChanges}
                onCheckedChange={(checked) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          notifications: {
                            ...prev.notifications,
                            batchRateChanges: checked,
                          },
                        }
                      : prev,
                  )
                }
              />
              <Field
                label="最小涨跌幅百分比"
                description="低于该值的倍率变化不发送通知。"
              >
                <Input
                  type="number"
                  step="0.01"
                  value={String(form.notifications.minChangePct)}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              minChangePct: Number(e.target.value || 0),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field
                label="余额不足冷却分钟"
                description="同一渠道重复告警的抑制时间。"
              >
                <Input
                  type="number"
                  value={String(form.notifications.balanceLowCooldownMinutes)}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              balanceLowCooldownMinutes: num(e.target.value),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field
                label="登录失败冷却分钟"
                description="同一渠道登录失败重复告警的抑制时间。0 表示每次都发。"
              >
                <Input
                  type="number"
                  value={String(form.notifications.loginFailedCooldownMinutes ?? 60)}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              loginFailedCooldownMinutes: num(e.target.value),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field
                label="每日剩余提醒百分比"
                description="Sub2API 订阅每日剩余额度低于该百分比时提醒，0 为关闭。"
              >
                <Input
                  type="number"
                  step="0.1"
                  value={String(form.notifications.subscriptionDailyRemainingThresholdPct)}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              subscriptionDailyRemainingThresholdPct: Number(e.target.value || 0),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field
                label="每周剩余提醒百分比"
                description="Sub2API 订阅每周剩余额度低于该百分比时提醒，0 为关闭。"
              >
                <Input
                  type="number"
                  step="0.1"
                  value={String(form.notifications.subscriptionWeeklyRemainingThresholdPct)}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              subscriptionWeeklyRemainingThresholdPct: Number(e.target.value || 0),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field
                label="每月剩余提醒百分比"
                description="Sub2API 订阅每月剩余额度低于该百分比时提醒，0 为关闭。"
              >
                <Input
                  type="number"
                  step="0.1"
                  value={String(form.notifications.subscriptionMonthlyRemainingThresholdPct)}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              subscriptionMonthlyRemainingThresholdPct: Number(e.target.value || 0),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field
                label="订阅到期提醒小时"
                description="Sub2API 订阅剩余小时数低于该值时提醒，0 为关闭。"
              >
                <Input
                  type="number"
                  value={String(form.notifications.subscriptionExpiryThresholdHours)}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              subscriptionExpiryThresholdHours: num(e.target.value),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field
                label="订阅提醒冷却分钟"
                description="同一渠道同一类订阅提醒的冷却时间。"
              >
                <Input
                  type="number"
                  value={String(form.notifications.subscriptionAlertCooldownMinutes)}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              subscriptionAlertCooldownMinutes: num(e.target.value),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field
                label="通知最大重试次数"
                description="发送失败后的最大尝试次数。"
              >
                <Input
                  type="number"
                  value={String(form.notifications.sendMaxAttempts)}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifications: {
                              ...prev.notifications,
                              sendMaxAttempts: num(e.target.value),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
            </div>
          </SectionCard>

          </div>
        </TabsContent>

        <TabsContent value="upstream" className="mt-0 min-w-0">
          <div className="space-y-5">
          <SectionCard
            icon={<Server className="size-4 text-indigo-600" />}
            title="上游请求"
            description="配置渠道访问上游站点时使用的超时时间和 User-Agent。"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="超时时间（秒）" description="小于等于 0 时使用默认 30 秒。">
                <Input
                  type="number"
                  min={0}
                  value={String(form.upstream.timeoutSeconds)}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            upstream: {
                              ...prev.upstream,
                              timeoutSeconds: num(e.target.value),
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field label="User-Agent" description="为空时使用 upstream-ops/0.1。">
                <Input
                  value={form.upstream.userAgent}
                  placeholder="upstream-ops/0.1"
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            upstream: {
                              ...prev.upstream,
                              userAgent: e.target.value,
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            icon={<Workflow className="size-4 text-violet-600" />}
            title="API 转发运行时（可选）"
            description="控制 API 转发、路由批量操作与调用错误日志截断；不影响上游账单采集。保存后点「应用配置」立即生效。"
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field
                label="转发超时（秒）"
                description={`单次上游转发/流式 drain 超时，默认 ${defaultGatewayConfig.forwardTimeoutSeconds}。`}
              >
                <Input
                  type="number"
                  min={1}
                  value={String(form.gateway?.forwardTimeoutSeconds ?? defaultGatewayConfig.forwardTimeoutSeconds)}
                  onChange={(e) =>
                    setForm((prev) =>
                      patchGateway(prev, "forwardTimeoutSeconds", num(e.target.value)),
                    )
                  }
                />
              </Field>
              <Field
                label="新建组默认冷却（秒）"
                description={`创建网关组时默认临时暂停时长，默认 ${defaultGatewayConfig.tempPauseSeconds}。`}
              >
                <Input
                  type="number"
                  min={0}
                  value={String(form.gateway?.tempPauseSeconds ?? defaultGatewayConfig.tempPauseSeconds)}
                  onChange={(e) =>
                    setForm((prev) =>
                      patchGateway(prev, "tempPauseSeconds", num(e.target.value)),
                    )
                  }
                />
              </Field>
              <Field
                label="新建组默认顺延次数"
                description={`创建组时默认最大 failover 切换次数，默认 ${defaultGatewayConfig.maxFailoverSwitches}。`}
              >
                <Input
                  type="number"
                  min={0}
                  max={32}
                  value={String(form.gateway?.maxFailoverSwitches ?? defaultGatewayConfig.maxFailoverSwitches)}
                  onChange={(e) =>
                    setForm((prev) =>
                      patchGateway(prev, "maxFailoverSwitches", num(e.target.value)),
                    )
                  }
                />
              </Field>
              <Field
                label="模型列表缓存 TTL（秒）"
                description={`公开 /v1/models 缓存时间，默认 ${defaultGatewayConfig.modelsCacheTTLSeconds}。`}
              >
                <Input
                  type="number"
                  min={0}
                  value={String(form.gateway?.modelsCacheTTLSeconds ?? defaultGatewayConfig.modelsCacheTTLSeconds)}
                  onChange={(e) =>
                    setForm((prev) =>
                      patchGateway(prev, "modelsCacheTTLSeconds", num(e.target.value)),
                    )
                  }
                />
              </Field>
              <Field
                label="路由批量操作并发"
                description={`测试模型 / 确保密钥 / 同步模型 / 拉源分组并发上限，默认 ${defaultGatewayConfig.routeBatchConcurrency}，最大 64。`}
              >
                <Input
                  type="number"
                  min={1}
                  max={64}
                  value={String(form.gateway?.routeBatchConcurrency ?? defaultGatewayConfig.routeBatchConcurrency)}
                  onChange={(e) =>
                    setForm((prev) =>
                      patchGateway(prev, "routeBatchConcurrency", num(e.target.value)),
                    )
                  }
                />
              </Field>
              <Field
                label="错误体落库上限（字节）"
                description={`用量错误响应体截断，默认 ${defaultGatewayConfig.usageErrorBodyBytes}。`}
              >
                <Input
                  type="number"
                  min={1024}
                  value={String(form.gateway?.usageErrorBodyBytes ?? defaultGatewayConfig.usageErrorBodyBytes)}
                  onChange={(e) =>
                    setForm((prev) =>
                      patchGateway(prev, "usageErrorBodyBytes", num(e.target.value)),
                    )
                  }
                />
              </Field>
              <Field
                label="错误摘要上限（字符）"
                description={`用量 error_message 截断，默认 ${defaultGatewayConfig.usageErrorMsgRunes}。`}
              >
                <Input
                  type="number"
                  min={64}
                  value={String(form.gateway?.usageErrorMsgRunes ?? defaultGatewayConfig.usageErrorMsgRunes)}
                  onChange={(e) =>
                    setForm((prev) =>
                      patchGateway(prev, "usageErrorMsgRunes", num(e.target.value)),
                    )
                  }
                />
              </Field>
              <Field
                label="单头值上限（字符）"
                description={`上游响应头单值截断，默认 ${defaultGatewayConfig.usageErrorHeaderValueRunes}。`}
              >
                <Input
                  type="number"
                  min={256}
                  value={String(
                    form.gateway?.usageErrorHeaderValueRunes ??
                      defaultGatewayConfig.usageErrorHeaderValueRunes,
                  )}
                  onChange={(e) =>
                    setForm((prev) =>
                      patchGateway(prev, "usageErrorHeaderValueRunes", num(e.target.value)),
                    )
                  }
                />
              </Field>
              <Field
                label="响应头 JSON 上限（字节）"
                description={`上游响应头整段 JSON 截断，默认 ${defaultGatewayConfig.usageErrorHeadersJSONBytes}。`}
              >
                <Input
                  type="number"
                  min={1024}
                  value={String(
                    form.gateway?.usageErrorHeadersJSONBytes ??
                      defaultGatewayConfig.usageErrorHeadersJSONBytes,
                  )}
                  onChange={(e) =>
                    setForm((prev) =>
                      patchGateway(prev, "usageErrorHeadersJSONBytes", num(e.target.value)),
                    )
                  }
                />
              </Field>
            </div>
          </SectionCard>

          </div>
        </TabsContent>

        <TabsContent value="proxy" className="mt-0 min-w-0">
          <div className="space-y-5">
          <SectionCard
            icon={<Network className="size-4 text-cyan-600" />}
            title="代理 IP"
            description="配置渠道上游请求使用的全局代理。只有渠道里开启代理 IP 的账号会使用这里的配置。"
            action={
              <Button
                size="sm"
                variant="outline"
                className="border-border bg-background"
                onClick={handleTestProxy}
                disabled={testingProxy}
              >
                <RefreshCw
                  className={cn("size-3.5", testingProxy ? "animate-spin" : "")}
                />
                {testingProxy ? "测试中..." : "测试代理"}
              </Button>
            }
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <InlineSwitch
                id="proxy-enabled"
                label="启用全局代理"
                description="关闭后所有已勾选代理 IP 的对象也会保持直连。"
                checked={form.proxy.enabled}
                onCheckedChange={(checked) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          proxy: { ...prev.proxy, enabled: checked },
                        }
                      : prev,
                  )
                }
              />
              <InlineSwitch
                id="proxy-version-check"
                label="检测更新走代理"
                description="开启后顶部自动检测更新和这里的检测更新会使用代理。"
                checked={form.proxy.versionCheckEnabled}
                onCheckedChange={(checked) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          proxy: {
                            ...prev.proxy,
                            versionCheckEnabled: checked,
                          },
                        }
                      : prev,
                  )
                }
              />
              <Field label="协议" description="支持 HTTP、HTTPS 和 SOCKS5。">
                <Select
                  value={form.proxy.protocol}
                  onValueChange={(value) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            proxy: {
                              ...prev.proxy,
                              protocol: value as "http" | "https" | "socks5",
                            },
                          }
                        : prev,
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="https">HTTPS</SelectItem>
                    <SelectItem value="socks5">SOCKS5</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="主机" description="代理服务器地址，不含协议。">
                <Input
                  value={form.proxy.host}
                  placeholder="127.0.0.1"
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            proxy: { ...prev.proxy, host: e.target.value },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field label="端口" description="代理服务监听端口。">
                <Input
                  type="number"
                  value={String(form.proxy.port || "")}
                  placeholder="7890"
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            proxy: { ...prev.proxy, port: num(e.target.value) },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field label="账号（可选）" description="代理认证用户名。">
                <Input
                  value={form.proxy.username}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            proxy: { ...prev.proxy, username: e.target.value },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
              <Field
                label="密码（可选）"
                description={
                  form.proxy.passwordConfigured
                    ? "代理密码已配置；留空保持不变，输入内容仅用于替换。"
                    : "尚未配置代理认证密码。"
                }
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.proxy.passwordReplacement}
                  placeholder={
                    form.proxy.passwordConfigured ? "已配置，留空不变" : "输入代理密码"
                  }
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            proxy: {
                              ...prev.proxy,
                              passwordReplacement: e.target.value,
                            },
                          }
                        : prev,
                    )
                  }
                />
              </Field>
            </div>
          </SectionCard>

          </div>
        </TabsContent>

        <TabsContent value="backup" className="mt-0 min-w-0">
          <div className="space-y-5">
          <SectionCard
            icon={<HardDrive className="size-4 text-slate-600" />}
            title="数据与备份"
            description="渠道、会话、快照等保存在数据目录；配置文件路径见页面顶部。生产环境请定期备份。"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <NoteBox title="建议备份内容">
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
                  <li>
                    <code className="text-[11px]">data/upstream-ops.db</code>
                    （及可选的 <code className="text-[11px]">-wal/-shm</code>）
                  </li>
                  <li>
                    <code className="text-[11px]">data/config.yaml</code>
                  </li>
                  <li>
                    Docker 示例：
                    <code className="mt-1 block whitespace-pre-wrap break-all text-[11px]">
                      docker compose exec app wget -q -O- http://localhost:8418/healthz
                    </code>
                    停机或热拷贝 <code className="text-[11px]">./data</code> 目录即可。
                  </li>
                </ul>
              </NoteBox>
              <div className="space-y-3">
                <NoteBox title="当前部署">
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    配置路径：
                    <span className="font-mono text-[11px] text-foreground">
                      {query.data?.config_path ?? "—"}
                    </span>
                    <br />
                    鉴权状态：
                    <span className="font-medium text-foreground">
                      {form.auth.enabled ? "已开启" : "已关闭（仅建议本机）"}
                    </span>
                  </p>
                </NoteBox>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => {
                    const payload = {
                      exported_at: new Date().toISOString(),
                      config_path: query.data?.config_path ?? null,
                      // 导出结构按字段白名单构造，瞬时替换值不会进入文件。
                      config: {
                        app: form.app,
                        auth: {
                          enabled: form.auth.enabled,
                          username: form.auth.username,
                          passwordConfigured: form.auth.passwordConfigured,
                          tokenSecretConfigured:
                            form.auth.tokenSecretConfigured,
                          sessionTTLHours: form.auth.sessionTTLHours,
                        },
                        scheduler: form.scheduler,
                        notifications: form.notifications,
                        proxy: {
                          enabled: form.proxy.enabled,
                          versionCheckEnabled:
                            form.proxy.versionCheckEnabled,
                          protocol: form.proxy.protocol,
                          host: form.proxy.host,
                          port: form.proxy.port,
                          username: form.proxy.username,
                          passwordConfigured:
                            form.proxy.passwordConfigured,
                        },
                        upstream: form.upstream,
                      },
                    }
                    const blob = new Blob([JSON.stringify(payload, null, 2)], {
                      type: "application/json",
                    })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    a.href = url
                    a.download = `upstream-ops-config-${new Date()
                      .toISOString()
                      .slice(0, 10)}.json`
                    a.click()
                    URL.revokeObjectURL(url)
                    toast.success("已下载脱敏配置（不含密码）")
                  }}
                >
                  <Download className="size-3.5" />
                  下载脱敏配置 JSON
                </Button>
              </div>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Web 备份与恢复</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    备份包含上游账号、通知中心、系统设置、API 转发数据和历史记录。下载文件受管理员鉴权保护。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    disabled={backupBusy || backupsLoading}
                    onClick={() => void handleCreateBackup()}
                  >
                    <HardDrive className="size-3.5" />
                    {backupBusy ? "处理中..." : "立即备份"}
                  </Button>
                  <input
                    ref={restoreInputRef}
                    type="file"
                    accept=".zip,application/zip"
                    className="hidden"
                    onChange={(event) => void handleRestoreBackup(event)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={backupBusy}
                    onClick={() => restoreInputRef.current?.click()}
                  >
                    <Upload className="size-3.5" />
                    上传并恢复
                  </Button>
                </div>
              </div>
              {restoredMessage && (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {restoredMessage}
                </p>
              )}
              <div className="mt-4 overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="bg-muted/40 text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">快照时间</th>
                      <th className="px-3 py-2 font-medium">类型</th>
                      <th className="px-3 py-2 font-medium">大小</th>
                      <th className="px-3 py-2 font-medium">校验</th>
                      <th className="px-3 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backupsLoading && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                          加载备份列表...
                        </td>
                      </tr>
                    )}
                    {!backupsLoading && backups.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                          暂无 Web 快照，点击“立即备份”创建第一份。
                        </td>
                      </tr>
                    )}
                    {!backupsLoading && backups.map((item) => (
                      <tr key={item.tag} className="border-t border-border">
                        <td className="px-3 py-2 font-mono">{item.tag}</td>
                        <td className="px-3 py-2">{item.driver === "sqlite" ? "SQLite 在线快照" : item.driver}</td>
                        <td className="px-3 py-2">{formatBackupSize(item.size_bytes)}</td>
                        <td className={cn("px-3 py-2", item.valid ? "text-emerald-700" : "text-destructive")}>
                          {item.valid ? "SHA-256 已通过" : item.error || "校验失败"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            disabled={backupBusy || !item.valid}
                            onClick={() => void handleDownloadBackup(item.tag)}
                          >
                            <Download className="size-3.5" />
                            下载
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            icon={<ShieldCheck className="size-4 text-rose-600" />}
            title="生产检查清单"
            description="对外暴露或 7×24 运行前，按下列项自检。改 compose 环境变量后需要重建/重启容器。"
          >
            <ul className="space-y-2 text-xs leading-5 text-muted-foreground">
              <li className="flex gap-2">
                <span className={form.auth.enabled ? "text-emerald-600" : "text-amber-700"}>
                  {form.auth.enabled ? "✓" : "!"}
                </span>
                <span>
                  <strong className="text-foreground">登录鉴权（配置）</strong>
                  ：当前 {form.auth.enabled ? "已在配置中开启" : "关闭（配置层允许匿名）"}。
                  生产请开启并设置强密码，保存后点「应用」；同时确认 `.env` 中
                  <code className="mx-1 text-[11px]">AUTH_ENABLED=true</code>
                  与容器环境一致。
                </span>
              </li>
              <li className="flex gap-2">
                <span
                  className={
                    anonProbe === "protected"
                      ? "text-emerald-600"
                      : anonProbe === "open"
                        ? "text-amber-700"
                        : "text-muted-foreground"
                  }
                >
                  {anonProbe === "protected" ? "✓" : anonProbe === "open" ? "!" : "•"}
                </span>
                <span>
                  <strong className="text-foreground">匿名 API 实测</strong>
                  ：
                  {anonProbe === "unknown" && "检测中…"}
                  {anonProbe === "protected" && "未带 Token 访问 /api/channels 返回 401（受保护）"}
                  {anonProbe === "open" &&
                    "未带 Token 仍可访问 /api/channels（当前可匿名调用）"}
                  {anonProbe === "error" && "探测失败，请手动检查网络"}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-2 h-6 px-2 text-[11px]"
                    disabled={probingAnon}
                    onClick={() => void probeAnonymousAccess()}
                  >
                    {probingAnon ? "检测中" : "重新检测"}
                  </Button>
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-muted-foreground">•</span>
                <span>
                  <strong className="text-foreground">密钥</strong>
                  ：轮换 <code className="text-[11px]">APP_SECRET</code> /
                  <code className="text-[11px]">AUTH_TOKEN_SECRET</code> 后旧会话会失效，需重新登录。
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-muted-foreground">•</span>
                <span>
                  <strong className="text-foreground">备份演练</strong>
                  ：升级前备份
                  <code className="mx-1 text-[11px]">data/upstream-ops.db</code>
                  与
                  <code className="mx-1 text-[11px]">data/config.yaml</code>
                  。推荐脚本
                  <code className="mx-1 text-[11px]">./scripts/backup-data.sh backup</code>
                  ，或复制下方命令。
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 gap-1.5 px-2 text-[11px]"
                    onClick={async () => {
                      const cmd = [
                        "# 推荐：",
                        "./scripts/backup-data.sh backup",
                        "./scripts/backup-data.sh list",
                        "# 恢复：./scripts/backup-data.sh restore 20260718_120000",
                        "",
                        "# 或手动：",
                        "mkdir -p data/backups",
                        "cp -a data/upstream-ops.db data/backups/upstream-ops.db.$(date +%Y%m%d_%H%M%S)",
                        "cp -a data/config.yaml data/backups/config.yaml.$(date +%Y%m%d_%H%M%S)",
                        "# docker compose stop app",
                        "# cp data/backups/upstream-ops.db.XXXX data/upstream-ops.db",
                        "# docker compose up -d",
                      ].join("\n")
                      try {
                        await navigator.clipboard.writeText(cmd)
                        toast.success("已复制备份/恢复命令到剪贴板")
                        window.localStorage.setItem(
                          "uh_last_backup_drill_copy",
                          new Date().toISOString(),
                        )
                      } catch {
                        toast.message(cmd)
                      }
                    }}
                  >
                    复制备份命令
                  </Button>
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-muted-foreground">•</span>
                <span>
                  <strong className="text-foreground">通知</strong>
                  ：至少配置一个可用渠道（Telegram / QQ OneBot / Webhook 等）并点「测试」验证。
                  Docker 内 QQ 机器人请用
                  <code className="mx-1 text-[11px]">host.docker.internal</code>
                  或宿主机 IP。
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-muted-foreground">•</span>
                <span>
                  <strong className="text-foreground">端口暴露</strong>
                  ：勿将未鉴权实例直接映射到公网；必要时前置反向代理与 HTTPS。
                </span>
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">
              更完整说明见仓库 <code className="text-[11px]">docs/FORK_NOTES.md</code>。
              {typeof window !== "undefined" &&
              window.localStorage.getItem("uh_last_backup_drill_copy")
                ? ` 最近复制备份命令：${window.localStorage.getItem("uh_last_backup_drill_copy")}`
                : ""}
            </p>
          </SectionCard>

          </div>
        </TabsContent>

        <TabsContent value="notifications" className="mt-0 min-w-0">
          <SectionCard
            icon={<Send className="size-4 text-violet-600" />}
            title="通知渠道"
            description="管理 Telegram、Webhook、邮件、企业微信、钉钉、飞书等通知出口。"
            action={
              <Button
                size="sm"
                variant="outline"
                className="border-border bg-background"
                onClick={() => {
                  setEditingNotification(null);
                  setNotificationOpen(true);
                }}
              >
                <Plus className="size-3.5" />
                新增渠道
              </Button>
            }
          >
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <MiniMetric
                title="渠道总数"
                value={String(notifications.data?.length ?? 0)}
              />
              <MiniMetric
                title="最近发送"
                value={lastSent ? relativeTime(lastSent) : "—"}
              />
              <MiniMetric
                title="最近失败"
                value={String(recentFailed)}
                danger={recentFailed > 0}
              />
            </div>
            {notifications.loading ? (
              <EmptyLine text="通知渠道加载中..." />
            ) : !notifications.data || notifications.data.length === 0 ? (
              <EmptyPanel
                title="还没有通知渠道"
                description="新增一个通知渠道后，就可以用于余额告警、登录失败和倍率变化提醒。"
              />
            ) : (
              <div className="space-y-3">
                {notifications.data.map((channel) => {
                  const Icon = notifyIcon(channel.type);
                  const subCount = parseSubCount(channel.subscriptions);
                  return (
                    <div
                      key={channel.id}
                      className="rounded-md border border-border bg-background p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div
                            className={cn(
                              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border",
                              channel.enabled
                                ? "border-violet-200 bg-violet-50 text-violet-700"
                                : "border-border bg-muted/40 text-muted-foreground",
                            )}
                          >
                            <Icon className="size-4" />
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {channel.name}
                              </p>
                              <Badge
                                variant="outline"
                                className="border-border bg-muted/40"
                              >
                                {typeLabel(channel.type)}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "border-transparent",
                                  channel.enabled
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-500",
                                )}
                              >
                                {channel.enabled ? "启用中" : "已禁用"}
                              </Badge>
                              {channel.proxy_enabled ? (
                                <Badge
                                  variant="outline"
                                  className="border-transparent bg-cyan-50 text-cyan-700"
                                >
                                  代理 IP
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {subCount === 0
                                ? "订阅全部渠道和分组"
                                : `已配置 ${subCount} 条订阅规则`}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyNotificationID === channel.id}
                            onClick={() => handleTestNotification(channel)}
                          >
                            测试发送
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingNotification(channel);
                              setNotificationOpen(true);
                            }}
                          >
                            <PencilLine className="size-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={busyNotificationID === channel.id}
                            onClick={() => handleDeleteNotification(channel)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="captcha" className="mt-0 min-w-0">
          <SectionCard
            icon={<KeyRound className="size-4 text-rose-600" />}
            title="验证码服务"
            description="管理用于处理 Turnstile 的打码平台，供渠道登录时自动调用。"
            action={
              <Button
                size="sm"
                variant="outline"
                className="border-border bg-background"
                onClick={() => {
                  setEditingCaptcha(null);
                  setCaptchaOpen(true);
                }}
              >
                <Plus className="size-3.5" />
                新增服务
              </Button>
            }
          >
            <div className="mb-4 grid gap-3 md:grid-cols-2">
              <MiniMetric
                title="服务数量"
                value={String(captchas.data?.length ?? 0)}
              />
              <MiniMetric
                title="用途"
                value="登录验证"
                hint="渠道启用 Turnstile 时调用"
              />
            </div>
            {captchas.loading ? (
              <EmptyLine text="验证码服务加载中..." />
            ) : !captchas.data || captchas.data.length === 0 ? (
              <EmptyPanel
                title="还没有验证码服务"
                description="如果某些渠道登录需要 Turnstile 验证，在这里接入 CapSolver、2Captcha 等服务。"
              />
            ) : (
              <div className="space-y-3">
                {captchas.data.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-md border border-border bg-background p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">
                            {item.name}
                          </p>
                          <Badge
                            variant="outline"
                            className="border-border bg-muted/40"
                          >
                            {captchaLabel(item.type)}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "border-transparent",
                              item.enabled
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-500",
                            )}
                          >
                            {item.enabled ? "启用中" : "已禁用"}
                          </Badge>
                          {item.proxy_enabled ? (
                            <Badge
                              variant="outline"
                              className="border-transparent bg-cyan-50 text-cyan-700"
                            >
                              代理 IP
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {item.endpoint
                            ? `自定义 Endpoint：${item.endpoint}`
                            : "使用平台默认 Endpoint"}
                        </p>
                        <p
                          className={cn(
                            "text-xs",
                            item.balance_error
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          剩余额度：{formatCaptchaBalance(item)}
                          {item.balance_error
                            ? ` · ${item.balance_error}`
                            : item.balance_at
                              ? ` · 更新于 ${relativeTime(item.balance_at)}`
                              : " · 未更新"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={busyCaptchaID === item.id}
                          onClick={() => handleRefreshCaptchaBalance(item)}
                        >
                          <RefreshCw
                            className={cn(
                              "size-4",
                              busyCaptchaID === item.id ? "animate-spin" : "",
                            )}
                          />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingCaptcha(item);
                            setCaptchaOpen(true);
                          }}
                        >
                          <PencilLine className="size-4" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={busyCaptchaID === item.id}
                          onClick={() => handleDeleteCaptcha(item)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        </div>
      </Tabs>

      <NotificationFormDialog
        open={notificationOpen}
        onOpenChange={(open) => {
          setNotificationOpen(open);
          if (!open) setEditingNotification(null);
        }}
        channel={editingNotification}
      />

      <CaptchaFormDialog
        open={captchaOpen}
        onOpenChange={(open) => {
          setCaptchaOpen(open);
          if (!open) setEditingCaptcha(null);
        }}
        config={editingCaptcha}
      />

      {confirmDialog}
    </section>
  );
}

function SettingsStatus({
  label,
  value,
  tone = "neutral",
  mono = false,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warning";
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-4">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full bg-muted-foreground",
            tone === "good" && "bg-emerald-500",
            tone === "warning" && "bg-amber-500",
          )}
        />
        <p className={cn("truncate text-sm font-medium text-foreground", mono && "font-mono text-xs")}>{value}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  const reactId = useId();
  const controlId = `settings-field-${reactId.replace(/:/g, "")}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id: controlId,
        "aria-describedby": descriptionId,
      })
    : children;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor={controlId} className="text-xs font-medium text-foreground">
          {label}
        </Label>
        {description ? (
          <p id={descriptionId} className="text-[11px] leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {control}
    </div>
  );
}

function SectionCard({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-panel p-4 sm:p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {icon}
            {title}
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function InlineSwitch({
  id,
  label,
  description,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/45 px-4 py-3">
      <div className="space-y-1">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function NoteBox({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
      <p className="text-xs font-semibold text-emerald-700">
        {title}
      </p>
      <div className="mt-1 leading-6">{children}</div>
    </div>
  );
}

function MiniMetric({
  title,
  value,
  hint,
  danger = false,
}: {
  title: string;
  value: string;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/45 px-4 py-3">
      <p className="text-[11px] text-muted-foreground">{title}</p>
      <p
        className={cn(
          "mt-1 text-sm font-semibold",
          danger ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function EmptyPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="surface-empty px-4 py-6">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function typeLabel(type: NotificationChannelType) {
  const map: Record<NotificationChannelType, string> = {
    telegram: "Telegram",
    webhook: "Webhook",
    email: "邮件",
    wecom: "企业微信",
    dingtalk: "钉钉",
    feishu: "飞书",
    serverchan3: "Server酱³",
    qqbot: "QQ 机器人 (OneBot)",
    qqofficial: "QQ 官方机器人",
  };
  return map[type] ?? type;
}

function captchaLabel(type: CaptchaConfig["type"]) {
  const map: Record<CaptchaConfig["type"], string> = {
    capsolver: "CapSolver",
    "2captcha": "2Captcha",
    anticaptcha: "AntiCaptcha",
    yescaptcha: "YesCaptcha",
  };
  return map[type] ?? type;
}

function formatCaptchaBalance(item: CaptchaConfig) {
  if (item.last_balance == null) return "—";
  if (item.balance_unit === "points") return `${decimal(item.last_balance, 0)} 点`;
  return money(item.last_balance, { precise: true });
}

function notifyIcon(type: NotificationChannelType) {
  const map: Partial<Record<NotificationChannelType, typeof Send>> = {
    telegram: Send,
    webhook: Send,
    email: Send,
    wecom: Send,
    dingtalk: Send,
    feishu: Send,
    serverchan3: Send,
    qqbot: Send,
    qqofficial: Send,
  };
  return map[type] ?? Send;
}

function parseSubCount(raw?: string) {
  if (!raw) return 0;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}
