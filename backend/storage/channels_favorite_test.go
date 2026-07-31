package storage

import (
	"errors"
	"testing"

	"gorm.io/gorm"
)

func TestChannelFavoritePersistsWithoutOverwritingChannel(t *testing.T) {
	db := openTestDB(t)
	if !db.Migrator().HasColumn(&Channel{}, "Favorite") {
		t.Fatal("channels.favorite column was not migrated")
	}

	channels := NewChannels(db)
	original := &Channel{
		Name:           "favorite-channel",
		Type:           ChannelTypeNewAPI,
		SiteURL:        "https://favorite.example.com",
		Username:       "operator",
		PasswordCipher: "encrypted-secret",
		MonitorEnabled: true,
	}
	if err := channels.Create(original); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if original.Favorite {
		t.Fatal("new channel favorite = true, want false")
	}

	favorited, err := channels.SetFavorite(original.ID, true)
	if err != nil {
		t.Fatalf("set favorite: %v", err)
	}
	if !favorited.Favorite {
		t.Fatal("favorite = false, want true")
	}
	if favorited.Name != original.Name || favorited.PasswordCipher != original.PasswordCipher || !favorited.MonitorEnabled {
		t.Fatalf("unrelated channel fields changed: %#v", favorited)
	}

	unfavorited, err := channels.SetFavorite(original.ID, false)
	if err != nil {
		t.Fatalf("clear favorite: %v", err)
	}
	if unfavorited.Favorite {
		t.Fatal("favorite = true, want false")
	}

	reloaded, err := channels.FindByID(original.ID)
	if err != nil {
		t.Fatalf("reload channel: %v", err)
	}
	if reloaded.Favorite {
		t.Fatal("persisted favorite = true, want false")
	}
}

func TestChannelSetFavoriteNotFound(t *testing.T) {
	channels := NewChannels(openTestDB(t))
	if _, err := channels.SetFavorite(999999, true); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("SetFavorite error = %v, want gorm.ErrRecordNotFound", err)
	}
}
