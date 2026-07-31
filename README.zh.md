# RouteScope

[English README](README.md) | [RouteScope 仓库](https://github.com/owen891/RouteScope)

> RouteScope 是一个自托管上游运营控制台，用于统一管理渠道健康、倍率与成本、Sub2API 上游同步，以及 API 转发路由。

**当前版本：v0.1.0**

RouteScope 面向单一可信运维者，把上游状态、运营记录、路由配置、通知和运行时设置集中到同一个控制台。主发布形态是 Docker Compose + SQLite，数据持久化在项目目录下的 <code>./data</code>。

## 项目功能

- **总览**：集中查看渠道健康、余额、成本、最近采集事实和运营风险。
- **渠道与账号**：管理 NewAPI / Sub2API 渠道、鉴权信息、监控状态、收藏、API Key、充值、兑换和账号检查。
- **告警动态**：集中查看告警、上游公告、采集事实和健康探测。
- **分组倍率**：查看每条上游的分组倍率和变化历史，用于比较成本和路由决策。
- **上游同步**：把渠道账号同步到 Sub2API，管理目标、分组、代理、模型限制、倍率换算和执行日志。
- **API 转发**：提供统一 <code>/v1</code> 入口，支持模型映射、权重调度、协议转换、故障转移、访问密钥、直连 Provider 和用量记录。
- **真实消费**：查看上游请求、Token、延迟和成本估算，支持筛选和统计。
- **通知中心**：管理通知渠道、订阅规则、冷却时间、重试策略和发送记录。
- **系统设置**：管理后台鉴权、代理、调度、保留策略、备份检查、Captcha、版本检查和可热更新配置。

## 快速启动

### Docker Compose + SQLite

1. 创建环境文件：

   ~~~bash
   cp .env.example .env
   ~~~

2. 在 <code>.env</code> 中设置固定的应用主密钥，并开启后台登录：

   ~~~env
   APP_SECRET=replace-with-a-random-string-at-least-32-bytes
   AUTH_ENABLED=true
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=replace-with-a-strong-password
   ~~~

3. 启动：

   ~~~bash
   docker compose up -d
   ~~~

4. 打开 <code>http://localhost:8080</code>，使用上面配置的管理员账号登录。

Docker 默认使用 <code>ghcr.io/owen891/routescope</code> 镜像，宿主机端口可用 <code>HTTP_PORT</code> 修改。SQLite 数据和运行时配置位于项目目录：

~~~text
data/upstream-ops.db
data/config.yaml
~~~

生产环境建议固定版本，不要长期使用 <code>latest</code>：

~~~env
IMAGE_TAG=v0.1.0
~~~

### 可选 MySQL

需要 MySQL 时，使用基础 Compose 和 MySQL 覆盖文件：

~~~bash
docker compose -f docker-compose.yml -f docker-compose.mysql.yml up -d
~~~

启动前在 <code>.env</code> 中填写 <code>APP_SECRET</code>、<code>MYSQL_DATABASE</code>、<code>MYSQL_USER</code>、<code>MYSQL_PASSWORD</code> 和 <code>MYSQL_ROOT_PASSWORD</code>。

## 使用教程

### 1. 先保护控制台

只要服务不是严格的本机内网服务，就保持 <code>AUTH_ENABLED=true</code>，设置强管理员密码，并通过反向代理或其他访问控制限制暴露范围。

<code>APP_SECRET</code> 用于加密上游密码、Cookie、Token、通知密钥、SMTP 密码、Captcha Key 和 Sub2API 目标密钥。数据写入后不要更换它。

### 2. 添加上游渠道

进入 **渠道与账号**，添加 NewAPI 或 Sub2API 渠道：

1. 填写站点地址并选择鉴权方式。
2. 按上游支持情况填写用户名密码，或使用 Token / Cookie。
3. 开启监控并设置低余额阈值。
4. 保存后测试登录，再执行第一次余额和倍率同步。
5. 首次采集成功后，检查渠道详情和 API Key 操作。

上游需要时，可以在系统设置中配置 Captcha Provider 和 HTTP / HTTPS / SOCKS5 代理。

### 3. 查看运营状态

用 **总览** 查看当前摘要；用 **告警动态** 检查采集失败、健康探测、公告和通知发送情况；用 **分组倍率** 比较不同上游分组倍率和变更历史，再决定后续同步或路由动作。

### 4. 配置通知

进入 **通知中心**，先添加通知渠道，再创建订阅规则。规则可以接收全部事件，也可以限制到指定上游和倍率分组。发送尝试、失败原因和冷却状态都会保留，便于排障。

当前支持 Telegram、Webhook、Email、企业微信、钉钉、飞书、ServerChan3，以及当前构建启用的 QQ Bot。

### 5. 同步到 Sub2API

进入 **上游同步**：

1. 添加并测试可写入的 Sub2API 目标。
2. 同步目标分组和代理列表。
3. 创建同步分组，选择来源渠道、来源分组、目标分组、代理、模型限制、并发数、权重和倍率换算方式。
4. 预览账号映射后再执行应用。
5. 查看执行日志，需要时测试目标账号。

远端删除和其他写入动作都是显式操作。执行前应再次确认目标和同步分组状态。

### 6. 配置 API 转发

进入 **API 转发**，依次配置：

1. 转发分组，以及重试、故障转移、冷却和排序策略。
2. 一个或多个路由，来源可以是已监控渠道，也可以是直连 Provider。
3. 模型映射和模型列表模式：<code>auto</code>、<code>manual</code> 或 <code>hybrid</code>。
4. 给客户端使用的 Gateway Key。

客户端使用 Gateway Key，不使用上游账号 Key：

~~~http
Authorization: Bearer sk-your-gateway-key
~~~

常用接口：

~~~text
GET  /v1/models
POST /v1/chat/completions
POST /v1/responses
POST /v1/messages
GET  /v1/usage
~~~

转发层支持 OpenAI Chat / Completions、OpenAI Responses 和 Anthropic Messages，并在路由支持时处理流式协议转换。路由可以配置权重调度、倍率换算、模型改写、首字超时、临时暂停和上游错误故障转移。

### 7. 查看真实消费

进入 **真实消费**，按模型、接口、分组、成功状态和时间筛选上游或转发用量。重点检查 Token、延迟、请求 ID、基础成本和实际成本，再调整价格或路由倍率。

## 配置说明

| 变量 | 作用 |
| --- | --- |
| <code>HTTP_PORT</code> | Compose 对外端口，默认 <code>8080</code>。 |
| <code>IMAGE_TAG</code> | 镜像版本，发布时使用 <code>v0.1.0</code>。 |
| <code>APP_SECRET</code> | 加密应用数据的固定 AES-GCM 主密钥，必填。 |
| <code>AUTH_ENABLED</code> | 是否启用后台登录；公网或共享主机必须开启。 |
| <code>ADMIN_USERNAME</code> | 后台管理员账号。 |
| <code>ADMIN_PASSWORD</code> | 后台管理员密码，开启鉴权时必填。 |
| <code>AUTH_TOKEN_SECRET</code> | 可选 Token 签名密钥；为空时回退到 <code>APP_SECRET</code>。 |
| <code>DATABASE_DRIVER</code> | <code>sqlite</code> 或 <code>mysql</code>。 |
| <code>DATABASE_PATH</code> | SQLite 路径，Compose 默认 <code>/app/data/upstream-ops.db</code>。 |
| <code>DATABASE_HOST</code> / <code>DATABASE_PORT</code> | MySQL 连接配置。 |
| <code>DATABASE_USER</code> / <code>DATABASE_PASSWORD</code> / <code>DATABASE_NAME</code> | MySQL 用户、密码和数据库名。 |
| <code>SERVER_MODE</code> / <code>LOG_LEVEL</code> | 运行模式和日志级别。 |

代理、调度、保留策略、通知、Captcha、上游 HTTP 和 API 转发设置可以在 **系统设置** 中修改。鉴权、调度、通知策略、代理、上游 HTTP 和转发运行时设置支持点击“应用”后热更新；数据库连接、HTTP 端口和日志级别需要重启。

## 本地开发

环境要求：Go 1.23+、Node.js 20+、pnpm 10.4.0。

启动后端：

~~~bash
go run ./cmd/server
~~~

后端默认地址为 <code>http://127.0.0.1:8418</code>。

另开终端启动前端：

~~~bash
cd frontend
pnpm install
pnpm dev
~~~

Vite 默认地址为 <code>http://127.0.0.1:3010</code>，并将 API 请求代理到后端。

运行主要检查：

~~~bash
go test ./...
cd frontend
pnpm lint
pnpm test
pnpm exec tsc --noEmit --incremental false
pnpm build
~~~

## 备份与安全

- SQLite 部署可直接进入 **系统设置 → 数据备份 → Web 备份与恢复**，创建一致性快照、下载 ZIP，或上传 ZIP 恢复。Web 恢复会先自动创建恢复前安全快照，校验 SHA-256、数据库驱动和 `APP_SECRET` 指纹，然后替换数据库与配置并重启服务。MySQL 部署仍使用下方服务器脚本，Web 页面会明确提示当前不支持。

- 升级、迁移、导入或远端写入前先创建并校验带标签的快照：

  ~~~bash
  BACKUP_TAG=before-upgrade ./scripts/backup-data.sh backup
  ./scripts/backup-data.sh verify before-upgrade
  ~~~

  Windows 使用 <code>powershell -ExecutionPolicy Bypass -File scripts/backup-data.ps1 -Command backup</code>；校验或恢复时传入 <code>-Tag before-upgrade</code>。脚本会根据当前 Compose 的有效配置自动识别 SQLite 或 MySQL。SQLite 快照包含数据库和 <code>config.yaml</code>；MySQL 快照包含经过校验的 <code>mysqldump</code> 和同一份运行时配置。数据库行会保留上游账号、通知渠道/订阅、Captcha/API 凭据、同步目标、Gateway Provider/Key/Route 以及运行历史。
- 只恢复已校验的标签，并确认健康检查通过：

  ~~~bash
  ./scripts/backup-data.sh restore before-upgrade
  ~~~

  加密凭据恢复时必须使用原来的 <code>APP_SECRET</code>。manifest 只记录它的 SHA-256 指纹，恢复时密钥不匹配会拒绝执行；密钥本身不会被复制到快照。
- 加密数据创建后不要更改 <code>APP_SECRET</code>，除非已经准备好迁移流程。
- README 示例、截图、测试夹具和日志中不要放真实密码、API Key、Cookie 或 Token。
- 后台控制台应保持鉴权，并根据需要用状态、配额、IP 规则和路由策略限制 Gateway Key。
- 变更后检查同步预览、执行日志、Gateway 用量和通知失败记录。

## License

MIT
