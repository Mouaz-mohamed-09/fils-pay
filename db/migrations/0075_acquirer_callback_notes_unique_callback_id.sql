-- FP-201: nothing deduped acquirer callback redeliveries. 0051's comment
-- relied on a processed_events table and an FP-238 index, neither of which
-- exists, so a redelivered callback wrote a second identical note.
-- The acquirer issues each callback_id once, so rows sharing one are
-- redeliveries: keep the earliest, then make callback_id unique.
DELETE FROM acquirer_callback_notes a
 USING acquirer_callback_notes b
 WHERE a.callback_id = b.callback_id
   AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX acquirer_callback_notes_callback_id_key
    ON acquirer_callback_notes (callback_id);
