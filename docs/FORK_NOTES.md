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
| 更新已有 | 导入弹窗重名策略选「更新已有渠道凭据」（名称或 site_url 匹配） |
| 失败筛选 / 同步失败 | 渠道栏下拉与按钮 |
| 改密码 / 重贴 Token | 失败卡片快捷按钮 |
| QQ 机器人 | 设置 → 通知渠道 → 类型「QQ 机器人 (OneBot)」 |
| 备份说明 | 设置 → 系统设置 →「数据与备份」 |

### QQ 机器人（Docker 注意）

机器人在宿主机、UpstreamOps 在容器时，`base_url` **不要**填 `http://127.0.0.1:端口`。

- Docker Desktop (Windows/Mac)：`http://host.docker.internal:5700`（端口按你的 NapCat/go-cqhttp 为准）
- Linux：常用宿主机局域网 IP，或 `172.17.0.1`

## 生产建议

1. `.env`：`AUTH_ENABLED=true`，设置强 `ADMIN_PASSWORD` / `AUTH_TOKEN_SECRET`
2. 定期复制 `data/upstream-ops.db` 与 `data/config.yaml`
3. 升级前先备份 `data/`，再换镜像

设置页可开关鉴权并「保存 + 应用」；若 compose 环境变量与 config 不一致，以实际是否出现登录页为准。

## 测试

```bash
cd frontend && pnpm test && pnpm build
go test ./backend/notify/ -count=1
```

## 与官方差异（概要）

- 前端：导入、错误分类、筛选、设置备份/鉴权提示、QQ 表单
- 后端：`notify/qqbot` + `NotifyQQBot` 类型
- 工程：vitest、本地 build 脚本、本说明

合并官方新版本：fetch tag → 解决冲突 → `./scripts/build-local.sh` → 备份 data 后 `docker compose up -d`。

## Ops 脚本（不进运行时）

`data/` 下可能存在本地脚本（如 `import_backup.py`、`extract_quark_tokens.py`），仅离线使用，**不要**提交含 token 的 JSON/DB。
