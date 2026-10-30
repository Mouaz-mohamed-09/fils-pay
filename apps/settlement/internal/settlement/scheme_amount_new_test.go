package settlement

import (
	"testing"
	"time"

	"github.com/filspay/settlement/internal/money"
)

// The stored scheme amount must be exactly amount_fils / 1000 (ADR-0002),
// never a rounded-up gross.
func TestSchemeAmountBD_MatchesTruncatedFils(t *testing.T) {
	cases := []struct {
		in   money.Fils
		want string
	}{
		{4747, "4.74"},
		{4755, "4.75"},
		{1005, "1.00"},
		{4740, "4.74"},
		{12344, "12.34"},
		{9, "0.00"},
		{0, "0.00"},
	}
	for _, tc := range cases {
		if got := SchemeAmountBD(tc.in); got != tc.want {
			t.Errorf("SchemeAmountBD(%d) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// 22:30 UTC on 28 Oct is 01:30 on 29 Oct in Bahrain; the daemon must treat
// 29 Oct as "today".
func TestBusinessDateOf_UsesBahrainCalendar(t *testing.T) {
	now := time.Date(2026, 10, 28, 22, 30, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(BusinessDateOf(now))
	want := time.Date(2026, 10, 28, 21, 0, 0, 0, time.UTC) // 29 Oct 00:00 Bahrain
	if !start.Equal(want) {
		t.Errorf("BusinessDayWindow(BusinessDateOf(%s)) start = %s, want %s", now, start.UTC(), want)
	}
}

func TestVolumeTierMdrBonusBps_AboveInt32(t *testing.T) {
	if got := VolumeTierMdrBonusBps(3_000_000_000); got != 15 {
		t.Errorf("VolumeTierMdrBonusBps(3e9) = %d, want 15", got)
	}
}
