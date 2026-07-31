package feishu

import "errors"

var (
	ErrDisabled      = errors.New("feishu control channel is disabled")
	ErrNotConfigured = errors.New("feishu control channel is not fully configured")
	ErrAlreadyBound  = errors.New("feishu approver is already bound")
)
