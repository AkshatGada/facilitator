/**
 * Exact Starknet Client Scheme
 *
 * Client-side implementation for Starknet exact payments.
 * Requires typedData to be present for settlement.
 */

import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from "@x402/core/types";
import type { Account } from "starknet";
import {
  createPaymentPayload,
  DEFAULT_PAYMASTER_ENDPOINTS,
  validateNetwork,
  type StarknetNetworkId,
} from "x402-starknet";

// ============================================================================
// Types
// ============================================================================

export interface ExactStarknetClientSchemeConfig {
  /** User account for signing Starknet typed data */
  account: Account;
  /** Paymaster endpoint override (string for all networks or per-network map) */
  paymasterEndpoint?: string | Partial<Record<StarknetNetworkId, string>>;
  /** Paymaster API key (string for all networks or per-network map) */
  paymasterApiKey?: string | Partial<Record<StarknetNetworkId, string>>;
}

export interface ExactStarknetClientConfig extends ExactStarknetClientSchemeConfig {
  /** Optional specific networks to register (defaults to mainnet + sepolia) */
  networks?: StarknetNetworkId | StarknetNetworkId[];
}

type PaymentPayloadWithTypedData = PaymentPayload & {
  typedData: Record<string, unknown>;
};

const DEFAULT_STARKNET_CLIENT_NETWORKS: StarknetNetworkId[] = [
  "starknet:mainnet",
  "starknet:sepolia",
];

// ============================================================================
// Helpers
// ============================================================================

export function assertStarknetTypedData(
  payload: PaymentPayload
): asserts payload is PaymentPayloadWithTypedData {
  const typedData = (payload as { typedData?: unknown }).typedData;
  const isObject =
    typeof typedData === "object" && typedData !== null && !Array.isArray(typedData);
  if (!isObject) {
    throw new Error("Starknet payment payload missing typedData (required).");
  }
}

function resolvePaymasterEndpoint(
  network: StarknetNetworkId,
  override?: string | Partial<Record<StarknetNetworkId, string>>
): string {
  if (typeof override === "string") {
    return override;
  }
  if (override?.[network]) {
    return override[network] as string;
  }
  return DEFAULT_PAYMASTER_ENDPOINTS[network];
}

function resolvePaymasterApiKey(
  network: StarknetNetworkId,
  override?: string | Partial<Record<StarknetNetworkId, string>>
): string | undefined {
  if (typeof override === "string") {
    return override;
  }
  return override?.[network];
}

// ============================================================================
// Client Scheme
// ============================================================================

export class ExactStarknetClientScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  private readonly account: Account;
  private readonly paymasterEndpoint?: string | Partial<Record<StarknetNetworkId, string>>;
  private readonly paymasterApiKey?: string | Partial<Record<StarknetNetworkId, string>>;

  constructor(config: ExactStarknetClientSchemeConfig) {
    if (!config.account) {
      throw new Error("Starknet account is required.");
    }
    this.account = config.account;
    this.paymasterEndpoint = config.paymasterEndpoint;
    this.paymasterApiKey = config.paymasterApiKey;
  }

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    const network = validateNetwork(requirements.network);
    const paymasterEndpoint = resolvePaymasterEndpoint(
      network,
      this.paymasterEndpoint
    );
    const paymasterApiKey = resolvePaymasterApiKey(
      network,
      this.paymasterApiKey
    );

    const paymentPayload = await createPaymentPayload(
      this.account,
      x402Version,
      requirements,
      {
        endpoint: paymasterEndpoint,
        network,
        ...(paymasterApiKey ? { apiKey: paymasterApiKey } : {}),
      }
    );

    assertStarknetTypedData(paymentPayload);

    return {
      x402Version,
      payload: paymentPayload.payload,
      typedData: paymentPayload.typedData,
      paymasterEndpoint: paymentPayload.paymasterEndpoint ?? paymasterEndpoint,
    } as PaymentPayload;
  }
}

// ============================================================================
// Registration Helper
// ============================================================================

export function registerExactStarknetClientScheme(
  client: { register(network: string, scheme: SchemeNetworkClient): unknown },
  config: ExactStarknetClientConfig
): ExactStarknetClientScheme {
  const { networks, ...schemeConfig } = config;
  const scheme = new ExactStarknetClientScheme(schemeConfig);
  const registerNetworks = Array.isArray(networks)
    ? networks
    : networks
      ? [networks]
      : DEFAULT_STARKNET_CLIENT_NETWORKS;

  for (const network of registerNetworks) {
    client.register(network, scheme);
  }

  return scheme;
}
