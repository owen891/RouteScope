# UpstreamOps 二改说明（本地运维版）

基于官方 [bejix/upstream-ops](https://github.com/bejix/upstream-ops) **v0.0.6** 的二次开发笔记。

## 目标

把 UpstreamOps 当作日常**上游运维控制台**使用，并补齐：

- all-api-hub 备份导入 / 更新
- 渠道失败原因分类与快捷修复
- 失败筛选与「只同步失败」
- QQ 机器人（OneBot HTTP）通知
- 鉴权状态提示与备份说明

**不做**：请求转发网关、支付中台、服务端读取浏览器扩展 LevelDB。

## 本地运行（二改镜像）

数据目录：`./data`（compose 挂载，勿提交）。

### 方式 A：完整 Docker 多阶段（网络正常时）

```bash
docker build -t upstream-ops:local .
```

### 方式 B：脚本捷径（推荐，少拉 golang 基础镜像）

Windows (Git Bash / PowerShell 均可调 bash)：

```bash
./scripts/build-local.sh
```

脚本会：`frontend` 安装依赖并 build → 嵌入 `web/dist` → `GOOS=linux` 编译 → 用 alpine 运行时打 `upstream-ops:local`。

### 启动

仓库内提供**示例**覆盖文件写法（不要提交含隐私的 override）：

```yaml
# docker-compose.override.yml（本地）
services:
  app:
    image: upstream-ops:local
```

```bash
# .env 中至少 APP_SECRET、HTTP_PORT=8088
docker compose up -d
# 打开 http://localhost:8088
```

回退官方镜像：删除/改名 `docker-compose.override.yml`，`IMAGE_TAG=v0.0.6 docker compose up -d`。

## 功能入口

| 功能 | 入口 |
|------|------|
| 导入 all-api-hub | 监控页渠道栏「导入」 |
| 更新已有 | 导入默认「更新」；名称或 site_url 匹配 |
| 仅同步本次写入 | 导入完成后勾选「同步本次写入」 |
| 失败筛选 / 同步失败 / 失败优先 | 渠道栏下拉、按钮；默认列表失败置顶 |
| 批量改密码 | 失败筛选后批量操作 |
| 改密码 / 重贴 Token / 打码 | 失败卡片快捷按钮；Turnstile 深链验证码页 |
| 备注 / 标签 | 卡片展示 `login_extra_params` 中 notes/tagIds/source |
| 紧凑密度 | 渠道栏「紧凑 / 舒适」切换（localStorage） |
| QQ 机器人 | 设置 → 通知渠道 → 类型「QQ 机器人 (OneBot)」 |
| 生产检查 / 备份 | 设置 →「生产检查清单」；`scripts/backup-data.sh` |

### QQ 机器人（Docker 注意）

新建 QQ 渠道时表单默认 `http://host.docker.internal:5700`（假定容器访问宿主机机器人）。

| 部署 | base_url 建议 |
|------|----------------|
| Ops 在 Docker Desktop，机器人在宿主机 | `http://host.docker.internal:5700` |
| Ops 本机二进制，机器人本机 | `http://127.0.0.1:5700` |
| Linux 容器 → 宿主机 | 宿主机局域网 IP 或 `http://172.17.0.1:5700` |

**不要**在 Docker 内填 `127.0.0.1`（那是容器自身）。实测矩阵：群/私聊 × NapCat 或 go-cqhttp，以设置页「测试」通过为准。

## 生产建议

1. `.env`：`AUTH_ENABLED=true`，设置强 `ADMIN_PASSWORD` / `AUTH_TOKEN_SECRET`
2. 定期备份 `data/upstream-ops.db` 与 `data/config.yaml`
3. 升级前先备份 `data/`，再换镜像

设置页提供 **生产检查清单**（含匿名 API 实测、备份命令复制）、鉴权开关与「数据与备份」说明。可开关鉴权并「保存 + 应用」；若 compose 环境变量与 config 不一致，以清单里「匿名 API 实测」和是否出现登录页为准。

### 开启鉴权（推荐流程）

```bash
# 打印建议写入 .env 的鉴权段落（不会自动改文件，避免锁死）
./scripts/print-auth-env.sh
# 或指定密码：
./scripts/print-auth-env.sh 'YourStrongPass'

# Windows PowerShell（输出同样的配置段落，不会改写 .env）：
powershell -ExecutionPolicy Bypass -File ./scripts/print-auth-env.ps1

# 粘贴到 .env 后：
docker compose up -d --force-recreate

# 再在 UI：设置 → 登录鉴权 → 启用 → 同一密码 → 保存 → 应用
# 验证：未登录访问 /api/channels 应 401；设置页「匿名 API 实测」为受保护
```

### 备份 / 恢复演练（建议做一次）

```bash
# 备份（含可选 wal/shm）
./scripts/backup-data.sh backup
./scripts/backup-data.sh list

# 恢复（脚本会 stop app → 覆盖 → up）
./scripts/backup-data.sh restore 20260718_120000
```

等价手搓命令：

```bash
mkdir -p data/backups
cp -a data/upstream-ops.db data/backups/upstream-ops.db.$(date +%Y%m%d_%H%M%S)
cp -a data/config.yaml data/backups/config.yaml.$(date +%Y%m%d_%H%M%S)

docker compose stop app
cp data/backups/upstream-ops.db.XXXX data/upstream-ops.db
cp data/backups/config.yaml.XXXX data/config.yaml
rm -f data/upstream-ops.db-wal data/upstream-ops.db-shm
docker compose up -d
```

UI 还可下载**脱敏配置 JSON**（不含密码），便于存档非密钥配置。

## 测试

```bash
# Linux / macOS / Git Bash：完整发布门禁
./scripts/verify.sh

# Windows PowerShell：完整发布门禁
powershell -ExecutionPolicy Bypass -File ./scripts/verify.ps1
```

门禁包含：前端依赖锁定检查、lint、单测、生产构建、Go 全量测试和 Compose 配置校验。GitHub Actions 的 `Quality Gates` 使用同一组检查，镜像发布必须等待门禁通过。

生产部署在开启鉴权并重建容器后，还应执行匿名访问检查：

```bash
./scripts/check-production.sh
# 或 PowerShell
powershell -ExecutionPolicy Bypass -File ./scripts/check-production.ps1
```

默认检查 Compose 的 `http://localhost:8080`；自定义 `HTTP_PORT` 时可将目标 URL 作为 Bash 的首个参数或 PowerShell 的 `-BaseUrl` 传入。检查必须得到 `/healthz = 200`、匿名 `/api/channels = 401`。它不会读取或打印任何密码、Token。

## 与官方差异（概要）

- 前端：导入/更新、错误分类、筛选、批量改密、备注标签、紧凑列表、设置生产检查/备份提示、QQ 表单
- 后端：`notify/qqbot` + `NotifyQQBot` 类型
- 工程：vitest、`scripts/build-local.*`、`scripts/backup-data.sh`、`scripts/print-auth-env.sh`、本说明

合并官方新版本：fetch tag → 解决冲突 → `./scripts/backup-data.sh backup` → `./scripts/build-local.sh` → `docker compose up -d`。

## 仓库内 Ops 脚本

| 脚本 | 用途 |
|------|------|
| `scripts/build-local.sh` / `.ps1` | 复现 `upstream-ops:local` |
| `scripts/backup-data.sh` | `backup` / `list` / `restore <ts>` |
| `scripts/print-auth-env.sh` / `.ps1` | 打印建议鉴权 `.env` 段落（不自动写入） |
| `scripts/verify.sh` / `.ps1` | 运行与 CI 一致的发布质量门禁 |
| `scripts/check-production.sh` / `.ps1` | 验证健康检查与匿名 API 鉴权 |

## 仓外脚本（不进运行时 / 勿提交密钥）

`data/` 下可能存在本地脚本（如 `import_backup.py`、`extract_quark_tokens.py`），仅离线使用，**不要**提交含 token 的 JSON/DB。
