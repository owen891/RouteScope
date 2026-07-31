package storage

import (
	"testing"
	"time"
)

func TestUpstreamUsageSnapshotsPreserveLastSuccessOnFailure(t *testing.T) {
	db := openTestDB(t)
	repo := NewUpstreamUsageSnapshots(db)
	fetchedAt := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	if err := repo.SaveSuccess(7, "2026-07-23", "2026-07-29", "day", `{"source":"upstream_api"}`, fetchedAt); err != nil {
		t.Fatalf("save success: %v", err)
	}
	failedAt := fetchedAt.Add(time.Minute)
	if err := repo.SaveFailure(7, "2026-07-23", "2026-07-29", "day", "401 expired", failedAt); err != nil {
		t.Fatalf("save failure: %v", err)
	}
	item, err := repo.Find(7, "2026-07-23", "2026-07-29", "day")
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if item == nil || item.PayloadJSON == "" || item.LastError != "401 expired" {
		t.Fatalf("snapshot = %#v", item)
	}
	if item.FetchedAt == nil || !item.FetchedAt.Equal(fetchedAt) {
		t.Fatalf("fetched_at = %v, want %v", item.FetchedAt, fetchedAt)
	}

	refreshedAt := failedAt.Add(time.Minute)
	if err := repo.SaveSuccess(7, "2026-07-23", "2026-07-29", "day", `{"source":"upstream_api","ok":true}`, refreshedAt); err != nil {
		t.Fatalf("refresh success: %v", err)
	}
	item, err = repo.Find(7, "2026-07-23", "2026-07-29", "day")
	if err != nil || item == nil {
		t.Fatalf("find refreshed: %#v %v", item, err)
	}
	if item.LastError != "" || item.FetchedAt == nil || !item.FetchedAt.Equal(refreshedAt) {
		t.Fatalf("refreshed snapshot = %#v", item)
	}
}
