package storage

// phase09-status: automated pass

import (
	"testing"
	"time"
)

// phase09-surface: model:FeishuCallbackReceipt
func TestBaselineCharacterizationFeishuCallbackReceipt(t *testing.T) {
	db := openTestDB(t)
	if !db.Migrator().HasTable(&FeishuCallbackReceipt{}) {
		t.Fatal("AutoMigrate did not create feishu callback receipts")
	}

	now := time.Date(2026, time.July, 30, 9, 30, 0, 0, time.UTC)
	store := NewFeishuStore(db)
	claimed, err := store.ClaimCallback("phase09-event", "message", now)
	if err != nil || !claimed {
		t.Fatalf("claim callback: claimed=%v err=%v", claimed, err)
	}
	completedAt := now.Add(time.Minute)
	if err := store.CompleteCallback("phase09-event", "message", "processed", completedAt); err != nil {
		t.Fatalf("complete callback: %v", err)
	}
	var receipt FeishuCallbackReceipt
	if err := db.Where("event_id = ? AND kind = ?", "phase09-event", "message").First(&receipt).Error; err != nil {
		t.Fatalf("read callback receipt: %v", err)
	}
	if receipt.Outcome != "processed" || receipt.CompletedAt == nil || !receipt.CompletedAt.Equal(completedAt) {
		t.Fatalf("callback receipt = %#v", receipt)
	}
}

// phase09-surface: model:ModelPriceOverride
func TestBaselineCharacterizationModelPriceOverride(t *testing.T) {
	db := openTestDB(t)
	if !db.Migrator().HasTable(&ModelPriceOverride{}) {
		t.Fatal("AutoMigrate did not create model price overrides")
	}

	prices := NewModelPriceOverrides(db)
	if err := prices.Upsert(&ModelPriceOverride{
		ModelName:          "phase09-model",
		InputPricePerToken: 0.000001,
		Enabled:            true,
	}); err != nil {
		t.Fatalf("upsert model price: %v", err)
	}
	price, err := prices.FindByModel("phase09-model")
	if err != nil {
		t.Fatalf("read model price: %v", err)
	}
	if price == nil || price.InputPricePerToken != 0.000001 || !price.Enabled {
		t.Fatalf("model price = %#v", price)
	}
}

// phase09-surface: model:PrimaryRoute
func TestBaselineCharacterizationPrimaryRoute(t *testing.T) {
	db := openTestDB(t)
	if !db.Migrator().HasTable(&PrimaryRoute{}) {
		t.Fatal("AutoMigrate did not create primary routes")
	}

	now := time.Date(2026, time.July, 30, 9, 30, 0, 0, time.UTC)
	item := &PrimaryRoute{
		ModelName:  "phase09-primary",
		ChannelID:  9001,
		Operator:   "fixture-operator",
		SelectedAt: now,
	}
	if err := db.Create(item).Error; err != nil {
		t.Fatalf("create primary route: %v", err)
	}
	read, err := NewRouteAdviceStore(db).FindPrimary(item.ModelName)
	if err != nil {
		t.Fatalf("read primary route: %v", err)
	}
	if read == nil || read.ChannelID != item.ChannelID || read.Operator != item.Operator {
		t.Fatalf("primary route = %#v", read)
	}
}

// phase09-surface: model:RouteAdviceAudit
func TestBaselineCharacterizationRouteAdviceAudit(t *testing.T) {
	db := openTestDB(t)
	if !db.Migrator().HasTable(&RouteAdviceAudit{}) {
		t.Fatal("AutoMigrate did not create route advice audits")
	}

	now := time.Date(2026, time.July, 30, 9, 30, 0, 0, time.UTC)
	item := &RouteAdviceAudit{
		ModelName:    "phase09-audit",
		Action:       "set_primary",
		ChannelID:    9001,
		Operator:     "fixture-operator",
		SnapshotJSON: `{"source":"phase09"}`,
		CreatedAt:    now,
	}
	if err := db.Create(item).Error; err != nil {
		t.Fatalf("create route advice audit: %v", err)
	}
	audits, err := NewRouteAdviceStore(db).ListAudits(item.ModelName, 10)
	if err != nil {
		t.Fatalf("list route advice audits: %v", err)
	}
	if len(audits) != 1 || audits[0].Action != item.Action || audits[0].SnapshotJSON != item.SnapshotJSON {
		t.Fatalf("route advice audits = %#v", audits)
	}
}
