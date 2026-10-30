package splits

import (
	"sort"

	"github.com/filspay/settlement/internal/money"
)

// ChildWeight is one sub-merchant's configured share of a parent's payout.
type ChildWeight struct {
	WeightBps int64
}

// ChildShares distributes netPayout across children by their weights using
// largest-remainder allocation, so the shares always sum to netPayout
// exactly. Rounding each share on its own (ApplyRateFils per child) left a
// few fils per batch behind in the parent's merchant_payable.
func ChildShares(netPayout money.Fils, children []ChildWeight) []money.Fils {
	out := make([]money.Fils, len(children))
	var totalWeight int64
	for _, c := range children {
		totalWeight += c.WeightBps
	}
	if totalWeight <= 0 || netPayout <= 0 {
		return out
	}

	remainders := make([]int64, len(children))
	var allocated int64
	for i, c := range children {
		product := int64(netPayout) * c.WeightBps
		out[i] = money.Fils(product / totalWeight)
		remainders[i] = product % totalWeight
		allocated += int64(out[i])
	}

	// Hand the leftover fils, one each, to the largest remainders (ties to
	// the earlier child, so the result is deterministic).
	order := make([]int, len(children))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return remainders[order[a]] > remainders[order[b]] })
	for k := int64(0); k < int64(netPayout)-allocated; k++ {
		out[order[k]]++
	}
	return out
}
