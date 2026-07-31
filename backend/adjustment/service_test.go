package adjustment

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/bejix/upstream-ops/backend/connector/sub2api"
	"github.com/bejix/upstream-ops/backend/crypto"
	"github.com/bejix/upstream-ops/backend/notify"
	"github.com/bejix/upstream-ops/backend/storage"
)

type fakeAdminClient struct {
	group        sub2api.AdminGroup
	readOverride *sub2api.AdminGroup
	updates      []float64
	updateError  error
	uncertain    bool
}

func (f *fakeAdminClient) GetGroup(context.Context, sub2api.AdminTarget, int64) (*sub2api.AdminGroup, error) {
	if f.readOverride != nil {
		copy := *f.readOverride
		return &copy, nil
	}
	copy := f.group
	return &copy, nil
}

func (f *fakeAdminClient) UpdateGroupRatio(_ context.Context, _ sub2api.AdminTarget, _ int64, ratio float64) (*sub2api.AdminGroup, bool, error) {
	f.updates = append(f.updates, ratio)
	if f.updateError != nil {
		return nil, f.uncertain, f.updateError
	}
	f.group.Ratio = ratio
	f.group.RateMultiplier = ratio
	copy := f.group
	return &copy, false, nil
}

type fakeDispatcher struct {
	messages []notify.Message
	err      error
}

func (f *fakeDispatcher) Dispatch(_ context.Context, message notify.Message) error {
	f.messages = append(f.messages, message)
	return f.err
}

func newTestService(t *testing.T) (*Service, *fakeAdminClient, *fakeDispatcher) {
	t.Helper()
	db, err := storage.Open(storage.DBConfig{Driver: storage.DBDriverSQLite, Path: t.TempDir() + "/adjustment.db"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := storage.AutoMigrate(db); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	cipher, err := crypto.NewCipher("adjustment-test-secret")
	if err != nil {
		t.Fatalf("new cipher: %v", err)
	}
	keyCipher, err := cipher.Encrypt("admin-key")
	if err != nil {
		t.Fatalf("encrypt key: %v", err)
	}
	targets := storage.NewUpstreamSyncTargets(db)
	if err := targets.Create(&storage.UpstreamSyncTarget{
		ID: 1, Name: "production", BaseURL: "https://sub.example.com",
		AdminAPIKeyCipher: keyCipher, Enabled: true,
	}); err != nil {
		t.Fatalf("create target: %v", err)
	}
	groups := storage.NewUpstreamSyncTargetGroups(db)
	if err := groups.Upsert(&storage.UpstreamSyncTargetGroup{
		TargetID: 1, RemoteGroupID: 10, Name: "GPT mix", Ratio: 0.5, Status: "active",
	}); err != nil {
		t.Fatalf("create group: %v", err)
	}
	dispatcher := &fakeDispatcher{}
	service := NewService(targets, groups, storage.NewAdjustmentAudits(db), cipher, dispatcher)
	client := &fakeAdminClient{group: sub2api.AdminGroup{ID: 10, Name: "GPT mix", Ratio: 0.5, Status: "active"}}
	service.client = client
	return service, client, dispatcher
}

func TestAdjustmentExecuteRequiresConfirmationAndRejectsDrift(t *testing.T) {
	service, client, _ := newTestService(t)
	ctx := context.Background()

	preview, err := service.Preview(ctx, PreviewInput{TargetID: 1, RemoteGroupID: 10, NewRatio: 0.7})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if !preview.Executable || preview.BeforeRatio != 0.5 || preview.AfterRatio != 0.7 || preview.ChangePercent != 40 {
		t.Fatalf("preview = %#v", preview)
	}

	_, err = service.Execute(ctx, ExecuteInput{TargetID: 1, RemoteGroupID: 10, NewRatio: 0.7}, "operator")
	if !errors.Is(err, ErrConfirmationRequired) || len(client.updates) != 0 {
		t.Fatalf("unconfirmed err=%v updates=%v", err, client.updates)
	}

	_, err = service.Execute(ctx, ExecuteInput{
		TargetID: 1, RemoteGroupID: 10, ExpectedGroupName: "GPT mix",
		ExpectedCurrentRatio: 0.4, NewRatio: 0.7, Confirm: true,
	}, "operator")
	if !errors.Is(err, ErrRatioDrift) || len(client.updates) != 0 {
		t.Fatalf("drift err=%v updates=%v", err, client.updates)
	}
	audits, err := service.ListAudits(10)
	if err != nil || len(audits) != 0 {
		t.Fatalf("audits=%#v err=%v", audits, err)
	}
}

func TestAdjustmentExecuteAndRollbackAreAuditedAndNotified(t *testing.T) {
	service, client, dispatcher := newTestService(t)
	ctx := context.Background()

	audit, err := service.Execute(ctx, ExecuteInput{
		TargetID: 1, RemoteGroupID: 10, ExpectedGroupName: "GPT mix",
		ExpectedCurrentRatio: 0.5, NewRatio: 0.7, Confirm: true,
	}, "alice")
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if audit.Status != "succeeded" || audit.BeforeRatio != 0.5 || audit.AfterRatio != 0.7 || audit.Operator != "alice" {
		t.Fatalf("execute audit = %#v", audit)
	}
	if len(dispatcher.messages) != 1 || dispatcher.messages[0].Event != storage.EventAdjustmentExecuted {
		t.Fatalf("execute messages = %#v", dispatcher.messages)
	}

	rollbackPreview, err := service.RollbackPreview(ctx, audit.ID)
	if err != nil {
		t.Fatalf("rollback preview: %v", err)
	}
	if !rollbackPreview.Executable || rollbackPreview.BeforeRatio != 0.7 || rollbackPreview.AfterRatio != 0.5 {
		t.Fatalf("rollback preview = %#v", rollbackPreview)
	}
	rollback, err := service.Rollback(ctx, RollbackInput{
		AuditID: audit.ID, ExpectedCurrentRatio: 0.7, Confirm: true,
	}, "bob")
	if err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if rollback.Action != "rollback" || rollback.SourceAuditID == nil || *rollback.SourceAuditID != audit.ID || client.group.Ratio != 0.5 {
		t.Fatalf("rollback audit=%#v group=%#v", rollback, client.group)
	}
	if len(dispatcher.messages) != 2 || dispatcher.messages[1].Event != storage.EventAdjustmentRolledBack {
		t.Fatalf("rollback messages = %#v", dispatcher.messages)
	}
}

func TestAdjustmentRemoteFailureAndNotificationFailureRemainVisible(t *testing.T) {
	service, client, dispatcher := newTestService(t)
	ctx := context.Background()
	client.updateError = errors.New(`upstream unavailable api_key=admin-key access_token="token-value"`)

	audit, err := service.Execute(ctx, ExecuteInput{
		TargetID: 1, RemoteGroupID: 10, ExpectedGroupName: "GPT mix",
		ExpectedCurrentRatio: 0.5, NewRatio: 0.7, Confirm: true,
	}, "alice")
	if err == nil || audit == nil || audit.Status != "failed" || audit.ErrorMessage == "" {
		t.Fatalf("failed audit=%#v err=%v", audit, err)
	}
	if strings.Contains(audit.ErrorMessage, "admin-key") || strings.Contains(audit.ErrorMessage, "token-value") {
		t.Fatalf("audit leaked secret: %q", audit.ErrorMessage)
	}
	if _, rollbackErr := service.RollbackPreview(ctx, audit.ID); !errors.Is(rollbackErr, ErrNotRollbackable) {
		t.Fatalf("rollback failed audit err=%v", rollbackErr)
	}

	client.updateError = nil
	dispatcher.err = errors.New(`notification unavailable access_token="notify-secret"`)
	succeeded, err := service.Execute(ctx, ExecuteInput{
		TargetID: 1, RemoteGroupID: 10, ExpectedGroupName: "GPT mix",
		ExpectedCurrentRatio: 0.5, NewRatio: 0.8, Confirm: true,
	}, "alice")
	if err != nil || succeeded.Status != "succeeded" || succeeded.NotificationError == "" {
		t.Fatalf("notification failure audit=%#v err=%v", succeeded, err)
	}
	if strings.Contains(succeeded.NotificationError, "notify-secret") {
		t.Fatalf("notification error leaked secret: %q", succeeded.NotificationError)
	}
}

func TestAdjustmentUncertainWriteCanBeInspectedForRollback(t *testing.T) {
	service, client, _ := newTestService(t)
	client.updateError = errors.New("connection reset after write")
	client.uncertain = true
	audit, err := service.Execute(context.Background(), ExecuteInput{
		TargetID: 1, RemoteGroupID: 10, ExpectedGroupName: "GPT mix",
		ExpectedCurrentRatio: 0.5, NewRatio: 0.7, Confirm: true,
	}, "alice")
	if err == nil || audit == nil || audit.Status != "uncertain" {
		t.Fatalf("uncertain audit=%#v err=%v", audit, err)
	}
	if _, previewErr := service.RollbackPreview(context.Background(), audit.ID); previewErr != nil {
		t.Fatalf("uncertain rollback preview: %v", previewErr)
	}
}

func TestAdjustmentVerificationMismatchIsUncertainAndRollbackable(t *testing.T) {
	service, client, _ := newTestService(t)
	client.readOverride = &sub2api.AdminGroup{ID: 10, Name: "GPT mix", Ratio: 0.6, Status: "active"}
	audit, err := service.Execute(context.Background(), ExecuteInput{
		TargetID: 1, RemoteGroupID: 10, ExpectedGroupName: "GPT mix",
		ExpectedCurrentRatio: 0.6, NewRatio: 0.7, Confirm: true,
	}, "alice")
	if err == nil || audit == nil || audit.Status != "uncertain" {
		t.Fatalf("verification mismatch audit=%#v err=%v", audit, err)
	}
	if _, previewErr := service.RollbackPreview(context.Background(), audit.ID); previewErr != nil {
		t.Fatalf("verification mismatch rollback preview: %v", previewErr)
	}
}
