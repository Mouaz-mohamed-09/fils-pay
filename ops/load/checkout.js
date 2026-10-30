// k6 checkout scenario: the merchant creates a payment link, the buyer
// opens it and pays (authorize + capture). One iteration = one checkout.
//   BASE_URL, MERCHANT_ID, API_KEY from setup.ts; RATE = target checkouts/s.
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "https://localhost";
const RATE = Number(__ENV.RATE || 10);
const shed = new Counter("shed_503");
const acquirerErr = new Counter("acquirer_unavailable_502");

export const options = {
  insecureSkipTLSVerify: true,
  // When k6 runs in a container on the stack's network, point the site's
  // hostname at the gateway so TLS/SNI and routing are exactly as in production.
  hosts: __ENV.GATEWAY_IP ? { [BASE.replace(/^https?:\/\//, "").split(/[/:]/)[0]]: __ENV.GATEWAY_IP } : {},
  scenarios: {
    checkout: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: [
        { target: RATE, duration: __ENV.RAMP || "30s" },
        { target: RATE, duration: __ENV.HOLD || "60s" },
      ],
    },
  },
  thresholds: {
    "http_req_duration{step:pay}": ["p(95)<2000"],
    checks: ["rate>0.98"],
  },
};

const VALID_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

export default function () {
  const merchantHeaders = {
    authorization: `Bearer ${__ENV.API_KEY}`,
    "content-type": "application/json",
  };
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const create = http.post(
    `${BASE}/v1/merchants/${__ENV.MERCHANT_ID}/payment-links`,
    JSON.stringify({ amountFils: 4750, expiresAt, reference: "load" }),
    { headers: merchantHeaders, tags: { step: "create" } },
  );
  if (create.status === 503) { shed.add(1); return; }
  if (!check(create, { "link created": (r) => r.status === 201 })) return;
  const token = create.json("token");

  const view = http.get(`${BASE}/v1/payment-links/${token}`, { tags: { step: "view" } });
  if (view.status === 503) { shed.add(1); return; }
  check(view, { "link viewable": (r) => r.status === 200 });

  const pay = http.post(
    `${BASE}/v1/payment-links/${token}/pay`,
    JSON.stringify({ card: VALID_CARD }),
    {
      headers: { "content-type": "application/json", "idempotency-key": `${__VU}-${__ITER}-${Date.now()}` },
      tags: { step: "pay" },
    },
  );
  if (pay.status === 503) { shed.add(1); return; }
  // The simulator fails ~2% of acquirer calls by design (ACQUIRER_FAILURE_RATE):
  // a 402 decline or a 502 acquirer_unavailable (link released, retryable) is a
  // correct answer, not a server fault; counted separately.
  if (pay.status === 502 && String(pay.body).includes("acquirer_unavailable")) { acquirerErr.add(1); return; }
  check(pay, { "pay answered correctly": (r) => r.status === 200 || r.status === 402 });
}
