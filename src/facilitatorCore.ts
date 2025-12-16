import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { registerExactSvmScheme } from "@x402/svm/exact/facilitator";

import { evmSigner, svmSigner } from "./signers.js";
import { registerUptoEvmScheme } from "./schemes/upto/evm/registerFacilitator.js";

export const facilitator = new x402Facilitator()
  .onBeforeVerify(async (context) => {
    console.log("Before verify", context);
  })
  .onAfterVerify(async (context) => {
    console.log("After verify", context);
  })
  .onVerifyFailure(async (context) => {
    console.log("Verify failure", context);
  })
  .onBeforeSettle(async (context) => {
    console.log("Before settle", context);
  })
  .onAfterSettle(async (context) => {
    console.log("After settle", context);
  })
  .onSettleFailure(async (context) => {
    console.log("Settle failure", context);
  });

// Register EVM and SVM schemes (v2 exact + v2 upto + v2 exact solana)
registerExactEvmScheme(facilitator, {
  signer: evmSigner,
  networks: ["eip155:8453", "eip155:84532"], // Base mainnet and Base Sepolia
  deployERC4337WithEIP6492: true,
});

registerUptoEvmScheme(facilitator, {
  signer: evmSigner,
  networks: ["eip155:8453", "eip155:84532"], // Base mainnet and Base Sepolia
});

registerExactSvmScheme(facilitator, {
  signer: svmSigner,
  networks: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // Devnet
});
