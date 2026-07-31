package syncer

import (
	"context"
	"testing"
)

func TestListTargetUpstreamsReadsAccountsFromSelectedRemoteGroups(t *testing.T) {
	db := openSyncerTestDB(t)
	server, state := newAdminServer(t)
	defer server.Close()
	svc := newTestService(t, db, &fakeChannelService{})
	target, err := svc.CreateTarget(context.Background(), TargetInput{
		Name:        "target-discovery",
		BaseURL:     server.URL,
		AdminAPIKey: "admin-key",
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("create target: %v", err)
	}
	groups, err := svc.SyncTargetGroups(context.Background(), target.ID)
	if err != nil || len(groups) == 0 {
		t.Fatalf("sync target groups: groups=%#v err=%v", groups, err)
	}
	state.mu.Lock()
	state.accounts[42] = map[string]any{
		"id":              int64(42),
		"name":            "existing-upstream",
		"platform":        "openai",
		"type":            "apikey",
		"status":          "active",
		"schedulable":     true,
		"concurrency":     3,
		"priority":        2,
		"rate_multiplier": 0.08,
		"load_factor":     4,
		"group_ids":       []int64{groups[0].RemoteGroupID},
		"credentials":     map[string]any{"api_key": "must-not-leak"},
	}
	state.mu.Unlock()

	list, err := svc.ListTargetUpstreams(context.Background(), target.ID, []uint{groups[0].ID})
	if err != nil {
		t.Fatalf("list target upstreams: %v", err)
	}
	if len(list) != 1 || list[0].ID != 42 || list[0].Name != "existing-upstream" {
		t.Fatalf("target upstreams = %#v", list)
	}
	if list[0].RateMultiplier != 0.08 || list[0].LoadFactor != 4 || len(list[0].GroupNames) != 1 {
		t.Fatalf("target upstream details = %#v", list[0])
	}
}

func TestApplySyncGroupUpdatesExistingTargetUpstreamWithoutSourceChannel(t *testing.T) {
	db := openSyncerTestDB(t)
	server, state := newAdminServer(t)
	defer server.Close()
	svc := newTestService(t, db, &fakeChannelService{})
	target, err := svc.CreateTarget(context.Background(), TargetInput{
		Name:        "target-apply",
		BaseURL:     server.URL,
		AdminAPIKey: "admin-key",
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("create target: %v", err)
	}
	groups, err := svc.SyncTargetGroups(context.Background(), target.ID)
	if err != nil || len(groups) == 0 {
		t.Fatalf("sync target groups: groups=%#v err=%v", groups, err)
	}
	state.mu.Lock()
	state.accounts[43] = map[string]any{
		"id":              int64(43),
		"name":            "existing-upstream",
		"platform":        "openai",
		"type":            "apikey",
		"status":          "active",
		"schedulable":     true,
		"concurrency":     3,
		"priority":        2,
		"rate_multiplier": 0.08,
		"load_factor":     1,
		"group_ids":       []int64{groups[0].RemoteGroupID},
		"credentials":     map[string]any{"api_key": "preserve-me"},
	}
	state.mu.Unlock()
	targetAccountID := int64(43)
	rule, err := svc.CreateSyncGroup(SyncGroupDTO{
		NameTemplate:    "target-{同步分组ID}",
		TargetID:        target.ID,
		TargetGroupIDs:  []uint{groups[0].ID},
		Platform:        "openai",
		ModelLimitsMode: "custom",
		ModelLimits:     "gpt-test",
		Accounts: []SyncAccountDTO{{
			SourceMode:       "target",
			TargetAccountID:  &targetAccountID,
			RateConvertMode:  "custom",
			RateConvertValue: 0.12,
			Weight:           7,
			Concurrency:      9,
			Enabled:          true,
		}},
	})
	if err != nil {
		t.Fatalf("create target sync group: %v", err)
	}
	if _, err := svc.ApplySyncGroup(context.Background(), rule.ID); err != nil {
		t.Fatalf("apply target sync group: %v", err)
	}
	state.mu.Lock()
	updated := state.accounts[43]
	state.mu.Unlock()
	if updated["rate_multiplier"] != 0.12 || updated["load_factor"] != float64(7) || updated["concurrency"] != float64(9) {
		t.Fatalf("updated target account = %#v", updated)
	}
	if updated["credentials"].(map[string]any)["api_key"] != "preserve-me" {
		t.Fatalf("target credentials were replaced: %#v", updated["credentials"])
	}
}
