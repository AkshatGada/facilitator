/**
 * Simple Upto Test with Error Logging
 */

import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { createUnifiedClient } from "../../src/unifiedClient.js";
import { readFileSync } from "fs";

const API_URL = "http://localhost:4050/api/benchmark-upto";
const FACILITATOR_URL = "http://localhost:8090";
const RPC_URL = "https://polygon.gateway.tenderly.co/1bLJbEpGCgXFSNi3f5Q8Kb";

async function main() {
  console.log("🧪 Simple Upto Test with Error Logging\n");

  // Load wallet #2
  const walletConfig = JSON.parse(readFileSync("../wallets.json", "utf-8"));
  const wallet = walletConfig.wallets[1];
  
  const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
  console.log(`🔑 Wallet: ${account.address}\n`);

  // Create public client
  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(RPC_URL),
  });

  console.log("Creating unified client...");
  const { fetchWithPayment } = createUnifiedClient({
    evmUpto: {
      signer: account,
      publicClient,
      facilitatorUrl: FACILITATOR_URL,
    }
  });

  console.log("Making request to:", API_URL);
  
  try {
    const response = await fetchWithPayment(API_URL);
    console.log("\n✅ Response received!");
    console.log("Status:", response.status);
    console.log("Headers:", Object.fromEntries(response.headers.entries()));
    
    if (response.ok) {
      const data = await response.json();
      console.log("Data:", data);
    } else {
      const text = await response.text();
      console.log("Error:", text);
    }
  } catch (error) {
    console.log("\n❌ ERROR:");
    console.error(error);
    
    if (error instanceof Error) {
      console.log("\nError details:");
      console.log("Message:", error.message);
      console.log("Stack:", error.stack);
    }
  }
}

main();
