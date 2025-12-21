/**
 * Exact Starknet Facilitator Scheme
 *
 * Implements the SchemeNetworkFacilitator interface for Starknet exact payments.
 * Uses x402-starknet to verify and settle via a configured paymaster.
 */

import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  createProvider,
  verifyPayment,
  settlePayment,
  type PaymentPayload as StarknetPaymentPayload,
  type PaymentRequirements as StarknetPaymentRequirements,
  type StarknetNetworkId,
} from "x402-starknet";

export interface StarknetConfig {
  /** CAIP-2 network identifier (e.g., "starknet:mainnet") */
  network: StarknetNetworkId;
  /** RPC URL for Starknet network */
  rpcUrl: string;
  /** Paymaster endpoint to use for settlement */
  paymasterEndpoint: string;
  /** Optional paymaster API key */
  paymasterApiKey?: string;
  /** Sponsor address for /supported signers */
  sponsorAddress: string;
}

type PaymentPayloadWithTypedData = PaymentPayload & {
  typedData: Record<string, unknown>;
};

function hasTypedData(
  payload: PaymentPayload
): payload is PaymentPayloadWithTypedData {
  const typedData = (payload as { typedData?: unknown }).typedData;
  return (
    typeof typedData === "object" && typedData !== null && !Array.isArray(typedData)
  );
}

export class ExactStarknetScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "starknet:*";

  private readonly provider: ReturnType<typeof createProvider>;

  constructor(private readonly config: StarknetConfig) {
    if (!config.sponsorAddress) {
      throw new Error("Starknet sponsor address is required.");
    }
    this.provider = createProvider({
      network: config.network,
      rpcUrl: config.rpcUrl,
    });
  }

  getExtra(_network: string): Record<string, unknown> | undefined {
    return {
      paymasterEndpoint: this.config.paymasterEndpoint,
      sponsorAddress: this.config.sponsorAddress,
    };
  }

  getSigners(_network: string): string[] {
    return [this.config.sponsorAddress];
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    if (!hasTypedData(payload)) {
      return { isValid: false, invalidReason: "invalid_payload" };
    }
    return verifyPayment(
      this.provider,
      payload as StarknetPaymentPayload,
      requirements as StarknetPaymentRequirements
    );
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    if (!hasTypedData(payload)) {
      return {
        success: false,
        errorReason: "invalid_payload",
        transaction: "",
        network: requirements.network,
      };
    }
    return settlePayment(
      this.provider,
      payload as StarknetPaymentPayload,
      requirements as StarknetPaymentRequirements,
      {
        paymasterConfig: {
          endpoint: this.config.paymasterEndpoint,
          network: this.config.network,
          ...(this.config.paymasterApiKey
            ? { apiKey: this.config.paymasterApiKey }
            : {}),
        },
      }
    );
  }
}
