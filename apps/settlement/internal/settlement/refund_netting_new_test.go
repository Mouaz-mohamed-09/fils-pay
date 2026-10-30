package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// insertRefund records a succeeded refund the way processRefund.ts does.
func insertRefund(t *testing.T, pool *pgxpool.Pool, merchantID, txnID uuid.UUID, amount, feeReversed money.Fils, at time.Time) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status,
		                     acquirer_reference, reason, created_by_type, created_by_id, occurred_at)
		VALUES ($1, $2, $3, $4, 'succeeded', 'acq-test', 'test', 'merchant_api_key', $5, $6)
		RETURNING id
	`, txnID, merchantID, int64(amount), int64(feeReversed), uuid.New(), at).Scan(&id)
	if err != nil {
		t.Fatalf("insertRefund: %v", err)
	}
	return id
}

func refundBatchID(t *testing.T, pool *pgxpool.Pool, refundID uuid.UUID) *uuid.UUID {
	t.Helper()
	var batchID *uuid.UUID
	if err := pool.QueryRow(context.Background(), `SELECT settlement_batch_id FROM refunds WHERE id = $1`, refundID).Scan(&batchID); err != nil {
		t.Fatalf("read refund batch: %v", err)
	}
	return batchID
}

// FP-300: a refund in the window reduces that batch's gross, fee and payout.
func TestCloseBatch_NetsRefundsIntoPayout(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	txnID, fee := insertCaptureEvent(t, pool, merchantID, mdrBps, 10_000, start.Add(time.Hour))
	refundID := insertRefund(t, pool, merchantID, txnID, 4_000, 100, start.Add(2*time.Hour))

	result, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if result.GrossFils != 6_000 {
		t.Errorf("GrossFils = %d, want 6000 (10000 captured - 4000 refunded)", result.GrossFils)
	}
	if result.FeeFils != fee-100 {
		t.Errorf("FeeFils = %d, want %d (fee net of the 100 fils reversal)", result.FeeFils, fee-100)
	}
	if result.NetPayoutFils != 6_000-(fee-100) {
		t.Errorf("NetPayoutFils = %d, want %d", result.NetPayoutFils, 6_000-(fee-100))
	}
	if b := refundBatchID(t, pool, refundID); b == nil || *b != result.BatchID {
		t.Errorf("refund not claimed by batch %s (got %v)", result.BatchID, b)
	}

	payout, err := PayoutBatch(ctx, pool, result.BatchID)
	if err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}
	if payout.NetPayoutFils != result.NetPayoutFils {
		t.Errorf("paid %d, want the netted %d", payout.NetPayoutFils, result.NetPayoutFils)
	}
}

// A refund larger than a day's net is not netted into a negative payout; it
// stays unbatched and is claimed by a later batch that can absorb it.
func TestCloseBatch_CarriesOversizedRefundForward(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	day1 := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)
	day2 := day1.AddDate(0, 0, 1)
	start1, _ := BusinessDayWindow(day1)
	start2, _ := BusinessDayWindow(day2)

	bigTxn, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, 50_000, start1.Add(time.Hour))
	if _, err := CloseBatch(ctx, pool, merchantID, day1); err != nil {
		t.Fatalf("CloseBatch day1: %v", err)
	}

	// Day 2: a small sale and a large refund of yesterday's sale.
	_, smallFee := insertCaptureEvent(t, pool, merchantID, mdrBps, 1_000, start2.Add(time.Hour))
	refundID := insertRefund(t, pool, merchantID, bigTxn, 20_000, 500, start2.Add(2*time.Hour))
	r2, err := CloseBatch(ctx, pool, merchantID, day2)
	if err != nil {
		t.Fatalf("CloseBatch day2: %v", err)
	}
	if r2.NetPayoutFils != 1_000-smallFee {
		t.Errorf("day2 net = %d, want %d (refund too large to net, carried)", r2.NetPayoutFils, 1_000-smallFee)
	}
	if b := refundBatchID(t, pool, refundID); b != nil {
		t.Fatalf("oversized refund was claimed by %s; it should carry forward", *b)
	}

	// Day 3: enough volume to absorb it.
	day3 := day2.AddDate(0, 0, 1)
	start3, _ := BusinessDayWindow(day3)
	_, fee3 := insertCaptureEvent(t, pool, merchantID, mdrBps, 30_000, start3.Add(time.Hour))
	r3, err := CloseBatch(ctx, pool, merchantID, day3)
	if err != nil {
		t.Fatalf("CloseBatch day3: %v", err)
	}
	if b := refundBatchID(t, pool, refundID); b == nil || *b != r3.BatchID {
		t.Fatalf("carried refund not claimed by day3 batch")
	}
	want := money.Fils(30_000-20_000) - (fee3 - 500)
	if r3.NetPayoutFils != want {
		t.Errorf("day3 net = %d, want %d", r3.NetPayoutFils, want)
	}
}
