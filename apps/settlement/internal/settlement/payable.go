package settlement

import (
	"github.com/filspay/settlement/internal/money"
)

// NetPayableFils derives the net payout from frozen gross and fee totals.
// Integer fils only: the previous float32 BD arithmetic kept ~7 significant
// digits, so any batch above ~16,777 BD paid out a rounded figure.
func NetPayableFils(grossFils, feeFils money.Fils) money.Fils {
	return grossFils - feeFils
}
