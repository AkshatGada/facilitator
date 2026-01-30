# Upto Scheme Transaction Demo

This demo shows how the Upto payment scheme batches multiple API calls into a single on-chain settlement transaction.

## Context

### Two Payment Schemes

**Exact Scheme:**
- Each API call = 1 on-chain USDC transfer
- High gas cost (~$0.006 per call)
- Easy to track (each call visible on-chain)

**Upto Scheme:**
- Multiple API calls batched into 1 settlement
- Low gas cost (~97% savings)
- Challenge: Individual calls not visible on-chain

### The Problem

When using Upto scheme with 5 API calls of $0.001 each:
- **What happens**: 5 API calls verified off-chain → 1 settlement transaction of $0.005
- **What blockchain shows**: Single `Transfer` event with value `5000`
- **Missing information**: No way to tell this was 5 payments vs 1 payment

This affects metrics tracking since analytics platforms counting USDC transfers will see 1 transaction instead of 5.

## Test Results

Example transaction from this demo:
- **Settlement tx**: https://polygonscan.com/tx/0xfef5f8725011fc1e3cbad4974b9706b18edc9fda63356cf43771477888531806
- **Amount**: 5000 (0.005 USDC)
- **From**: `0x329214D7DC7d9E16147F5F99a65087fbFa9A3af4`
- **To**: `0xBBc4344Bb405858959d81aB1DEadD7a13EC37E13`

**Analysis**: Impossible to determine from blockchain data alone that this was 5 individual payments.

---

## Quick Start

### Prerequisites

1. Facilitator wallet with MATIC for gas (e.g., `0xBBc4344Bb405858959d81aB1DEadD7a13EC37E13`)
2. Test wallets with USDC (generated via `bun run benchmark:setup`)

### Run the Demo

**Terminal 1: Start Facilitator**
```bash
cd /Users/agada/facilitator
bun dev
```

**Terminal 2: Start API Server**
```bash
cd /Users/agada/facilitator
bun run benchmarks/comparison-api-server.ts
```

**Terminal 3: Run Test**
```bash
cd /Users/agada/facilitator
tsx benchmarks/upto-demo/test-upto-batch.ts
```

### What You'll See

```
🧪 Upto Scheme Batch Test (5 payments)

🔑 Wallet: 0x329214D7DC7d9E16147F5F99a65087fbFa9A3af4
💰 Permit Cap: 0.005 USDC (5000 units)

📞 Making API calls...
Call 1/5... ✅ (permit transaction sent)
Call 2/5... ✅ (off-chain verification)
Call 3/5... ✅ (off-chain verification)
Call 4/5... ✅ (off-chain verification)
Call 5/5... ✅ (off-chain verification)

⏳ Waiting for settlement...
✅ Settlement tx: https://polygonscan.com/tx/0x...

Result: 5 API calls → 1 on-chain transaction
```

### Verify on PolygonScan

Check the settlement transaction:
1. Function: `transferFrom(from, to, value)`
2. Event: `Transfer(from, to, 5000)`
3. **Key observation**: No indication this was 5 batched payments

---

## Files

- `test-upto-batch.ts` - Full test with 5 API calls and settlement tracking
- `test-upto-simple.ts` - Simple single API call test with error logging

---

## Possible Solutions

### 1. Custom Event Tracker Contract

Deploy a lightweight contract that emits events for each verified payment:

```solidity
event PaymentVerified(
    address indexed payer,
    address indexed payee,
    uint256 amount,
    bytes32 sessionId,
    uint256 timestamp
)
```

**Result**: Analytics can count `PaymentVerified` events instead of just `Transfer` events.

**Trade-off**: Adds ~$0.0003 per payment (still 95% cheaper than Exact scheme).

### 2. Micro-Settlements

Batch fewer payments (e.g., every 2-3 calls instead of 10+):
- More settlements = more visible transactions
- Still saves ~87% on gas vs Exact scheme

### 3. Off-Chain Proof

Provide analytics team with:
- Database of individual payments
- Session data linking to settlement transactions
- Verification that payment totals match on-chain transfers

---

## Questions for Analytics Team

1. Can you index custom events from our tracker contract?
2. Would you trust our custom events, or only canonical USDC Transfer events?
3. Is there any other on-chain signal we can use to show batch counts?

---

## Network Details

- **Network**: Polygon (CAIP-2: `eip155:137`)
- **USDC**: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`
- **Price**: $0.001 USDC per API call
- **Facilitator**: `0xBBc4344Bb405858959d81aB1DEadD7a13EC37E13`
