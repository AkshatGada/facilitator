/**
 * Paid API Example - Resource Server with x402 Payment Middleware
 *
 * Demonstrates a resource server that accepts both exact and upto payments.
 *
 * Usage:
 *   1. Start the facilitator: bun run dev
 *   2. Start this server: bun run examples/paidApi.ts
 *
 * Endpoints:
 *   GET  /api/premium        - Exact payment ($0.01 EVM)
 *   GET  /api/premium-solana - Exact payment ($0.01 Solana)
 *   GET  /api/upto-premium   - Batched payment (upto scheme)
 *   GET  /api/upto-session/:id - Check session status
 *   POST /api/upto-close     - Close and settle session
 */

import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { HTTPFacilitatorClient } from "@x402/core/http";

import { createElysiaPaymentMiddleware } from "../src/elysia/index.js";
import { evmAccount, svmAccount } from "../src/signers/index.js";
import { createResourceServer } from "../src/server.js";
import { createUptoModule, formatSession } from "../src/upto/lib.js";

// ============================================================================
// Configuration
// ============================================================================

const PORT = Number(4022);
const FACILITATOR_URL =
  process.env.FACILITATOR_URL ??
  `http://localhost:${process.env.FACILITATOR_PORT ?? 8090}`;

// ============================================================================
// Setup
// ============================================================================

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

// Create upto module with automatic sweeper
const upto = createUptoModule({
  facilitatorClient,
  sweeperConfig: {
    intervalMs: 30_000,
    idleSettleMs: 2 * 60_000,
  },
});

// Resource server with all payment schemes
const resourceServer = createResourceServer(facilitatorClient);

// ============================================================================
// Route Configuration
// ============================================================================

const routes = {
  "GET /api/premium": {
    accepts: {
      scheme: "exact",
      network: "eip155:8453",
      payTo: evmAccount.address,
      price: "$0.01",
    },
    description: "Premium content (EVM)",
    mimeType: "application/json",
  },
  "GET /api/premium-solana": {
    accepts: {
      scheme: "exact",
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      payTo: svmAccount.address,
      price: "$0.01",
    },
    description: "Premium content (Solana)",
    mimeType: "application/json",
  },
  "GET /api/upto-premium": {
    accepts: {
      scheme: "upto",
      network: "eip155:8453",
      payTo: evmAccount.address,
      price: {
        amount: "10000", // $0.01 per request (USDC 6 decimals)
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        extra: {
          name: "USD Coin",
          version: "2",
          maxAmountRequired: "50000", // $0.05 cap
        },
      },
    },
    description: "Premium content (batched payments)",
    mimeType: "application/json",
  },
} as const;

const paymentMiddleware = createElysiaPaymentMiddleware({
  resourceServer,
  routes,
  upto: { store: upto.store },
});

// ============================================================================
// Elysia Application
// ============================================================================

export const app = new Elysia({
  prefix: "/api",
  name: "paidApi",
  adapter: node(),
})
  .use(upto.sweeper)
  .use(paymentMiddleware)

  // ---- Routes ----

  .get("/premium", () => ({ message: "premium content (evm)" }))
  .get("/premium-solana", () => ({ message: "premium content (solana)" }))
  .get("/upto-premium", () => ({ message: "premium content (upto evm)" }))

  .get("/upto-session/:id", ({ params }) => {
    const session = upto.store.get(params.id);
    if (!session) return { error: "unknown_session" };
    return { id: params.id, ...formatSession(session) };
  })

  .post("/upto-close", async ({ body, set }) => {
    const { sessionId } = body as { sessionId?: string };
    if (!sessionId) {
      set.status = 400;
      return { error: "missing_session_id" };
    }

    const session = upto.store.get(sessionId);
    if (!session) {
      set.status = 404;
      return { error: "unknown_session" };
    }

    await upto.settleSession(sessionId, "manual_close", true);

    const updated = upto.store.get(sessionId);
    return {
      success: updated?.lastSettlement?.receipt.success ?? true,
      ...formatSession(updated ?? session),
    };
  });

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT);
console.log(`
Paid API listening on http://localhost:${PORT}
Facilitator: ${FACILITATOR_URL}

Endpoints:
  GET  /api/premium          - Exact payment ($0.01 EVM)
  GET  /api/premium-solana   - Exact payment ($0.01 Solana)
  GET  /api/upto-premium     - Batched payment (upto scheme)
  GET  /api/upto-session/:id - Check session status
  POST /api/upto-close       - Close and settle session
`);
