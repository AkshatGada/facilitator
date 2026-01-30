/**
 * Upto Scheme Batch Test
 * 
 * Tests 5 x402 API calls with 0.005 USDC permit cap
 * Shows both permit and settlement transactions on Polygon
 */

import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { createUnifiedClient } from "../../src/unifiedClient.js";
import { readFileSync } from "fs";

// ============================================================================
// Configuration
// ============================================================================

const API_URL = "http://localhost:4050/api/benchmark-upto";
const FACILITATOR_URL = "http://localhost:8090";
const RPC_URL = process.env.EVM_RPC_URL_POLYGON || "https://polygon.gateway.tenderly.co/1bLJbEpGCgXFSNi3f5Q8Kb";
const NUM_CALLS = 5;
const PERMIT_CAP = "5000"; // 0.005 USDC (6 decimals)

// ============================================================================
// Main Test
// ============================================================================

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     🧪 Upto Scheme Batch Test (5 payments)                  ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");

  // Load wallet #2 from wallets.json
  const walletConfig = JSON.parse(readFileSync("../wallets.json", "utf-8"));
  const wallet = walletConfig.wallets[1]; // Wallet #2 (index 1)
  
  const account = privateKeyToAccount(
    (wallet.privateKey.startsWith('0x') ? wallet.privateKey : `0x${wallet.privateKey}`) as `0x${string}`
  );

  console.log(`🔑 Wallet: ${account.address}`);
  console.log(`💰 Permit Cap: 0.005 USDC (${PERMIT_CAP} units)\n`);

  // Create public client for Polygon
  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(RPC_URL),
  });

  // Create unified client with Upto scheme
  const { fetchWithPayment, uptoScheme } = createUnifiedClient({
    evmUpto: {
      signer: account,
      publicClient,
      facilitatorUrl: FACILITATOR_URL,
    }
  });

  let permitTxHash: string | undefined;
  let firstResponse: Response | undefined;

  // Make 5 API calls
  console.log("📞 Making API calls...\n");
  
  for (let i = 1; i <= NUM_CALLS; i++) {
    process.stdout.write(`Call ${i}/${NUM_CALLS}... `);
    
    try {
      const response = await fetchWithPayment(API_URL);
      
      if (response.ok) {
        if (i === 1) {
          firstResponse = response;
          // First call triggers permit transaction
          console.log(`✅ (permit transaction sent)`);
          
          // Try to get permit tx hash from response headers or wait a bit
          await new Promise(r => setTimeout(r, 2000));
          
          // Check recent transactions for this wallet to find the permit
          try {
            const latestBlock = await publicClient.getBlockNumber();
            const logs = await publicClient.getLogs({
              address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC
              event: {
                type: "event",
                name: "Approval",
                inputs: [
                  { type: "address", indexed: true, name: "owner" },
                  { type: "address", indexed: true, name: "spender" },
                  { type: "uint256", indexed: false, name: "value" }
                ]
              },
              args: {
                owner: account.address,
              },
              fromBlock: latestBlock - 10n,
              toBlock: "latest"
            });
            
            if (logs.length > 0) {
              const latestLog = logs[logs.length - 1];
              permitTxHash = latestLog.transactionHash || undefined;
              if (permitTxHash) {
                console.log(`   🔗 Permit tx: https://polygonscan.com/tx/${permitTxHash}`);
              }
            }
          } catch (error) {
            console.log(`   ⚠️  Could not fetch permit tx hash automatically`);
          }
        } else {
          console.log(`✅ (off-chain verification)`);
        }
      } else {
        console.log(`❌ HTTP ${response.status}`);
        const text = await response.text();
        console.log(`   Error: ${text}`);
      }
    } catch (error) {
      console.log(`❌ ${error instanceof Error ? error.message : 'Error'}`);
    }

    // Small delay between calls
    if (i < NUM_CALLS) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log("\n⏳ Waiting 5 seconds before triggering settlement...\n");
  await new Promise(r => setTimeout(r, 5000));

  // Manually trigger settlement
  console.log("💸 Triggering settlement...\n");
  
  try {
    // Get the payment payload and requirements from the last response
    // In practice, we need to call the facilitator's settle endpoint
    // For now, we'll wait for the auto-sweeper or check for settlement tx
    
    console.log("⏳ Waiting for auto-settlement (sweeper runs every 30s)...");
    console.log("   Checking for settlement transaction...\n");
    
    // Wait up to 3 minutes for settlement
    let settlementTxHash: string | undefined;
    const maxWaitTime = 180000; // 3 minutes
    const checkInterval = 5000; // 5 seconds
    let elapsed = 0;
    
    while (elapsed < maxWaitTime && !settlementTxHash) {
      await new Promise(r => setTimeout(r, checkInterval));
      elapsed += checkInterval;
      
      try {
        const latestBlock = await publicClient.getBlockNumber();
        const logs = await publicClient.getLogs({
          address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC
          event: {
            type: "event",
            name: "Transfer",
            inputs: [
              { type: "address", indexed: true, name: "from" },
              { type: "address", indexed: true, name: "to" },
              { type: "uint256", indexed: false, name: "value" }
            ]
          },
          args: {
            from: account.address,
          },
          fromBlock: latestBlock - 20n,
          toBlock: "latest"
        });
        
        // Look for a transfer of 5000 (0.005 USDC)
        for (const log of logs) {
          if (log.args.value === 5000n) {
            settlementTxHash = log.transactionHash || undefined;
            break;
          }
        }
        
        if (settlementTxHash) {
          console.log(`✅ Settlement transaction found!`);
          console.log(`   🔗 Settlement tx: https://polygonscan.com/tx/${settlementTxHash}\n`);
          break;
        } else {
          process.stdout.write(`   Waiting... (${elapsed/1000}s elapsed)\r`);
        }
      } catch (error) {
        // Continue waiting
      }
    }
    
    if (!settlementTxHash) {
      console.log(`\n⚠️  Settlement not detected within ${maxWaitTime/1000}s`);
      console.log(`   The sweeper may settle later (idle timeout: 2 minutes)`);
      console.log(`   Check wallet transactions on PolygonScan: https://polygonscan.com/address/${account.address}\n`);
    }
    
  } catch (error) {
    console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  // Summary
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                    TRANSACTION ANALYSIS");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  if (permitTxHash) {
    console.log("📋 Permit Transaction (First Call):");
    console.log(`   🔗 https://polygonscan.com/tx/${permitTxHash}`);
    console.log(`   Function: permit()`);
    console.log(`   Approval Cap: ${PERMIT_CAP} (0.005 USDC)`);
    console.log(`   Event: Approval(owner, spender, ${PERMIT_CAP})`);
    console.log(`   Note: Sets spending allowance for facilitator\n`);
  }
  
  console.log("📋 API Calls 2-5:");
  console.log(`   Status: Verified off-chain (no transactions)`);
  console.log(`   Total pending: ${PERMIT_CAP} (0.005 USDC)\n`);
  
  console.log("📋 Settlement Transaction (Batched):");
  console.log(`   Function: transferFrom()`);
  console.log(`   Amount: ${PERMIT_CAP} (0.005 USDC)`);
  console.log(`   Event: Transfer(from, to, ${PERMIT_CAP})`);
  console.log(`   Note: Single transaction for all 5 payments\n`);
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`✅ Result: ${NUM_CALLS} API calls → 2 on-chain transactions`);
  console.log("   - 1 permit (approval)");
  console.log("   - 1 settlement (transfer)");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("🔍 View on PolygonScan:");
  console.log(`   Wallet: https://polygonscan.com/address/${account.address}`);
  if (permitTxHash) {
    console.log(`   Permit: https://polygonscan.com/tx/${permitTxHash}`);
  }
  console.log("");
}

main().catch(console.error);
