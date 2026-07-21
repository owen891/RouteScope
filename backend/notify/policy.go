package notify

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/bejix/upstream-ops/backend/storage"
)

// Policy 通知去抖策略。所有字段都是面向"少烦用户"取向：
//   - BatchRateChanges：同次扫描中合并多条倍率相关通知
//   - MinChangePct：涨跌幅小于阈值时跳过推送（仍写入 RateChangeLog 表）
//   - BalanceLowCooldown：同渠道 balance_low 在窗口内不重复发送
//   - LoginFailedCooldown：同渠道 login_failed 在窗口内不重复发送
//   - SendMaxAttempts：单条消息最多发送尝试次数（含首发），<=1 表示不重试
type Policy struct {
	NotificationPrefix                       string
	BatchRateChanges                         bool
	MinChangePct                             float64
	BalanceLowCooldown                       time.Duration
	LoginFailedCooldown                      time.Duration
	SubscriptionDailyRemainingThresholdPct   float64
	SubscriptionWeeklyRemainingThresholdPct  float64
	SubscriptionMonthlyRemainingThresholdPct float64
	SubscriptionExpiryThreshold              time.Duration
	SubscriptionAlertCooldown                time.Duration
	SendMaxAttempts                          int
}

// CooldownStore Dispatcher 用来判断某个 (channelID, event) 是否还在冷却窗口。
//
// 抽象成 interface 是为了让 dispatcher 不依赖具体存储；
// 生产实现是 *storage.Notifications.TryClaimCooldown；
// 测试时可以注入一个内存 stub。
type CooldownStore interface {
	TryClaimCooldown(channelID uint, event storage.NotificationEvent, cooldown time.Duration) (bool, error)
}

// RateChange 是一条待发送的倍率相关记录（去抖 / 合并的基本单元）。
type RateChange struct {
	GroupName string
	OldRatio  float64
	NewRatio  float64
	OldComp   float64
	NewComp   float64
	ChangedAt time.Time
}

type RateStructureChange struct {
	Added   []RateChange
	Removed []RateChange
}

// ChangePctAbove 涨跌幅是否达到阈值。
// minPct = 0 表示不过滤。OldRatio = 0 时按"新出现的分组"处理，永远算"达到阈值"。
func (rc RateChange) ChangePctAbove(minPct float64) bool {
	if minPct <= 0 {
		return true
	}
	if rc.OldRatio == 0 {
		return true
	}
	pct := math.Abs(rc.NewRatio-rc.OldRatio) / math.Abs(rc.OldRatio) * 100
	return pct >= minPct
}

// BuildBatchMessage 把多条 RateChange 合并成一条 notify.Message。
// 当只有 1 条时仍走这个路径，但 Subject / Body 自然退化成单条提醒。
func BuildBatchMessage(channel *storage.Channel, changes []RateChange) Message {
	return BuildRateBatchMessage(channel, storage.EventRateChanged, changes)
}

func BuildRateBatchMessage(channel *storage.Channel, event storage.NotificationEvent, changes []RateChange) Message {
	if channel == nil || len(changes) == 0 {
		return Message{}
	}
	now := time.Now()
	header := channelHeader(channel)
	if len(changes) == 1 {
		c := changes[0]
		if event == storage.EventRateAdded {
			return Message{
				Event:     storage.EventRateAdded,
				ChannelID: channel.ID,
				ModelName: c.GroupName,
				Subject:   fmt.Sprintf("分组新增 · %s · %s", channel.Name, c.GroupName),
				Body: strings.TrimSpace(fmt.Sprintf(
					"%s\n事件：分组新增\n分组：%s\n倍率：%s\n时间：%s",
					header, c.GroupName, formatRatio(c.NewRatio), now.Format("2006-01-02 15:04"),
				)),
			}
		}
		if event == storage.EventRateRemoved {
			return Message{
				Event:     storage.EventRateRemoved,
				ChannelID: channel.ID,
				ModelName: c.GroupName,
				Subject:   fmt.Sprintf("分组删除 · %s · %s", channel.Name, c.GroupName),
				Body: strings.TrimSpace(fmt.Sprintf(
					"%s\n事件：分组删除\n分组：%s\n原倍率：%s\n时间：%s",
					header, c.GroupName, formatRatio(c.OldRatio), now.Format("2006-01-02 15:04"),
				)),
			}
		}
		return Message{
			Event:     storage.EventRateChanged,
			ChannelID: channel.ID,
			ModelName: c.GroupName,
			Subject:   fmt.Sprintf("倍率变化 · %s · %s", channel.Name, c.GroupName),
			Body: strings.TrimSpace(fmt.Sprintf(
				"%s\n事件：倍率变化\n分组：%s\n倍率：%s → %s（%s %s）\n时间：%s",
				header,
				c.GroupName,
				formatRatio(c.OldRatio),
				formatRatio(c.NewRatio),
				arrowFor(c.OldRatio, c.NewRatio),
				formatChangePct(c.OldRatio, c.NewRatio),
				now.Format("2006-01-02 15:04"),
			)),
		}
	}

	// 合并多条：subject 简短，body 列出每条。仍是同一次扫描一起发，不做跨扫描延迟汇总。
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n", header)
	switch event {
	case storage.EventRateAdded:
		fmt.Fprintf(&b, "事件：分组新增（%d）\n", len(changes))
		for _, c := range changes {
			fmt.Fprintf(&b, "· %s  倍率 %s\n", c.GroupName, formatRatio(c.NewRatio))
		}
		fmt.Fprintf(&b, "时间：%s", now.Format("2006-01-02 15:04"))
		return Message{
			Event:     storage.EventRateAdded,
			ChannelID: channel.ID,
			ModelName: "",
			Subject:   fmt.Sprintf("分组新增 · %s · %d 个", channel.Name, len(changes)),
			Body:      strings.TrimSpace(b.String()),
		}
	case storage.EventRateRemoved:
		fmt.Fprintf(&b, "事件：分组删除（%d）\n", len(changes))
		for _, c := range changes {
			fmt.Fprintf(&b, "· %s  原倍率 %s\n", c.GroupName, formatRatio(c.OldRatio))
		}
		fmt.Fprintf(&b, "时间：%s", now.Format("2006-01-02 15:04"))
		return Message{
			Event:     storage.EventRateRemoved,
			ChannelID: channel.ID,
			ModelName: "",
			Subject:   fmt.Sprintf("分组删除 · %s · %d 个", channel.Name, len(changes)),
			Body:      strings.TrimSpace(b.String()),
		}
	default:
		fmt.Fprintf(&b, "事件：倍率变化（%d）\n", len(changes))
		for _, c := range changes {
			fmt.Fprintf(&b, "· %s  %s → %s（%s %s）\n",
				c.GroupName,
				formatRatio(c.OldRatio),
				formatRatio(c.NewRatio),
				arrowFor(c.OldRatio, c.NewRatio),
				formatChangePct(c.OldRatio, c.NewRatio),
			)
		}
		fmt.Fprintf(&b, "时间：%s", now.Format("2006-01-02 15:04"))
	}

	// ModelName 在合并消息里没有单一值；填空，订阅过滤改在 Dispatcher 里按"先按订阅切片再合并"处理。
	return Message{
		Event:     storage.EventRateChanged,
		ChannelID: channel.ID,
		ModelName: "",
		Subject:   fmt.Sprintf("倍率变化 · %s · %d 个分组", channel.Name, len(changes)),
		Body:      strings.TrimSpace(b.String()),
	}
}

func BuildRateStructureMessage(channel *storage.Channel, change RateStructureChange) Message {
	total := len(change.Added) + len(change.Removed)
	if channel == nil || total == 0 {
		return Message{}
	}
	now := time.Now()
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n事件：分组变动（新增 %d / 删除 %d）\n", channelHeader(channel), len(change.Added), len(change.Removed))
	if len(change.Added) > 0 {
		fmt.Fprintf(&b, "\n新增：\n")
		for _, c := range change.Added {
			fmt.Fprintf(&b, "· %s  倍率 %s\n", c.GroupName, formatRatio(c.NewRatio))
		}
	}
	if len(change.Removed) > 0 {
		fmt.Fprintf(&b, "\n删除：\n")
		for _, c := range change.Removed {
			fmt.Fprintf(&b, "· %s  原倍率 %s\n", c.GroupName, formatRatio(c.OldRatio))
		}
	}
	fmt.Fprintf(&b, "\n时间：%s", now.Format("2006-01-02 15:04"))

	return Message{
		Event:     storage.EventRateStructureChanged,
		ChannelID: channel.ID,
		ModelName: "",
		Subject:   fmt.Sprintf("分组变动 · %s · +%d/-%d", channel.Name, len(change.Added), len(change.Removed)),
		Body:      strings.TrimSpace(b.String()),
	}
}

func BuildBalanceLowMessage(channel *storage.Channel, balance, threshold float64) Message {
	if channel == nil {
		return Message{}
	}
	return Message{
		Event:     storage.EventBalanceLow,
		ChannelID: channel.ID,
		Subject:   fmt.Sprintf("余额不足 · %s", channel.Name),
		Body: strings.TrimSpace(fmt.Sprintf(
			"%s\n事件：余额不足\n当前余额：%s\n告警阈值：%s\n时间：%s",
			channelHeader(channel),
			formatMoney(balance),
			formatMoney(threshold),
			time.Now().Format("2006-01-02 15:04"),
		)),
	}
}

func BuildLoginFailedMessage(channel *storage.Channel, err error) Message {
	if channel == nil {
		return Message{}
	}
	reason := "未知错误"
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		reason = humanizeMonitorError(err.Error())
	}
	balance := "—"
	if channel.LastBalance != nil {
		balance = formatMoney(*channel.LastBalance)
	}
	return Message{
		Event:     storage.EventLoginFailed,
		ChannelID: channel.ID,
		Subject:   fmt.Sprintf("登录失败 · %s", channel.Name),
		Body: strings.TrimSpace(fmt.Sprintf(
			"%s\n事件：登录失败\n最近余额：%s\n原因：%s\n建议：检查账号密码/Token，必要时重贴登录态\n时间：%s",
			channelHeader(channel),
			balance,
			reason,
			time.Now().Format("2006-01-02 15:04"),
		)),
	}
}

func channelHeader(channel *storage.Channel) string {
	if channel == nil {
		return "渠道：—"
	}
	lines := []string{fmt.Sprintf("渠道：%s", channel.Name)}
	if site := strings.TrimSpace(channel.SiteURL); site != "" {
		lines = append(lines, "站点："+site)
	}
	if channel.LastBalance != nil {
		lines = append(lines, "余额："+formatMoney(*channel.LastBalance))
	} else {
		lines = append(lines, "余额：—")
	}
	if channel.BalanceThreshold > 0 {
		lines = append(lines, "阈值："+formatMoney(channel.BalanceThreshold))
	}
	return strings.Join(lines, "\n")
}

func formatRatio(v float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.4f", v), "0"), ".")
}

func formatMoney(v float64) string {
	return fmt.Sprintf("%.4f", v)
}

func formatChangePct(oldV, newV float64) string {
	if oldV == 0 {
		return "新增"
	}
	pct := (newV - oldV) / math.Abs(oldV) * 100
	sign := ""
	if pct > 0 {
		sign = "+"
	}
	return fmt.Sprintf("%s%.2f%%", sign, pct)
}

func humanizeMonitorError(raw string) string {
	s := strings.TrimSpace(raw)
	lower := strings.ToLower(s)
	switch {
	case strings.Contains(lower, "invalid refresh token"), strings.Contains(lower, "refresh token"):
		return "登录态失效（refresh token 无效），请重新登录或重贴 Token"
	case strings.Contains(lower, "401"), strings.Contains(lower, "unauthorized"):
		return "鉴权失败（401），请检查账号密码/Token"
	case strings.Contains(lower, "403"), strings.Contains(lower, "forbidden"):
		return "权限不足（403），请检查账号权限或站点限制"
	case strings.Contains(lower, "cloudflare"), strings.Contains(lower, "cf-ray"):
		return "站点被 Cloudflare/防护拦截，请稍后重试或检查网络/代理"
	case strings.Contains(lower, "timeout"), strings.Contains(lower, "deadline exceeded"):
		return "请求超时，请检查上游可达性或代理"
	case strings.Contains(lower, "connection refused"), strings.Contains(lower, "no such host"), strings.Contains(lower, "network is unreachable"):
		return "网络不可达，请检查域名/DNS/代理"
	case strings.Contains(lower, "invalid character '<'"):
		return "上游返回了网页而不是 API（可能登录页/防护页），请检查登录态"
	default:
		if len(s) > 180 {
			return s[:180] + "…"
		}
		return s
	}
}

func arrowFor(oldV, newV float64) string {
	switch {
	case newV > oldV:
		return "上涨"
	case newV < oldV:
		return "下调"
	default:
		return "调整"
	}
}
