package splits

import (
	"testing"

	"github.com/filspay/settlement/internal/money"
)

// Weights that don't divide evenly used to leave fils behind each batch.
func TestChildShares_UnevenSplitStillSumsToNet(t *testing.T) {
	children := []ChildWeight{{3333}, {3333}, {3334}}
	for _, net := range []money.Fils{10001, 9997, 1, 123457} {
		var total money.Fils
		for _, s := range ChildShares(net, children) {
			total += s
		}
		if total != net {
			t.Errorf("net %d: shares sum to %d", net, total)
		}
	}
}
