export interface paths {
  '/v1/price': {
    /** @description Public indicative SOL/USD reference from the payment pricing provider, not a locked payment quote. No payment is created or changed. Disabled when payments are disabled. No-store; limited to 6 requests per IP/minute and 60 globally/minute in addition to the general IP budget. fetchedAt is gateway retrieval time, not the time of the provider's last market update. */
    get: operations['getReferencePrice'];
  };
  '/v1/support/log-check': {
    /** @description Dev-only operator acceptance check, available even when payments are disabled. Requires a server-side merchant credential, consumes rate-limit counters and emits one fixed synthetic failure with the returned request ID. Returns 500 SUPPORT_LOG_CHECK deliberately; never creates, submits or settles a payment or calls providers. Limited to one authenticated check per merchant per minute. Not available in local or production environments. No request body is read or logged. */
    post: operations['checkSupportLogs'];
  };
  '/v1/payments': {
    post: operations['createPayment'];
  };
  '/v1/payments/{id}': {
    get: operations['getPayment'];
  };
  '/v1/checkout/{id}': {
    get: operations['getCheckout'];
  };
  '/v1/checkout/{id}/rpc': {
    /** @description Bounded read-only RPC for active unsettled payments. Only getGenesisHash with [] and getLatestBlockhash with [{commitment: finalized}]. No batches, notifications, arbitrary destinations or transaction submission. Limited to 12 requests per checkout/minute and 60 globally/minute in addition to existing limits. Provider failures are sanitized gateway errors. */
    post: operations['checkoutRpc'];
  };
  '/v1/checkout/{id}/transactions': {
    post: operations['submitTransaction'];
  };
}
/** OneOf type helpers */
type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };
type XOR<T, U> = T | U extends object
  ? (Without<T, U> & U) | (Without<U, T> & T)
  : T | U;
type OneOf<T extends any[]> = T extends [infer Only]
  ? Only
  : T extends [infer A, infer B, ...infer Rest]
    ? OneOf<[XOR<A, B>, ...Rest]>
    : never;

export type webhooks = Record<string, never>;

export interface components {
  schemas: {
    ReferencePrice: {
      /** @description Positive USD per SOL, represented as decimal text, possibly in exponent notation. */
      usdPrice: string;
      blockId: number;
      /** @description Gateway retrieval time in Unix milliseconds; not provider market-update time. */
      fetchedAt: number;
    };
    ReferencePriceEnvelope: {
      data: components['schemas']['ReferencePrice'];
      meta: {
        requestId: string;
      };
    };
    RpcId: string | number;
    CheckoutRpcRequest: {
      /** @constant */
      jsonrpc: '2.0';
      id: components['schemas']['RpcId'];
      /** @enum {string} */
      method: 'getGenesisHash' | 'getLatestBlockhash';
      params: unknown[];
    } & OneOf<
      [
        {
          /** @constant */
          method?: 'getGenesisHash';
          params?: unknown[];
        },
        {
          /** @constant */
          method?: 'getLatestBlockhash';
          params?: {
            /** @constant */
            commitment: 'finalized';
          }[];
        },
      ]
    >;
    CheckoutRpcResult: {
      /** @constant */
      jsonrpc: '2.0';
      id: components['schemas']['RpcId'];
      result: OneOf<
        [
          'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
          {
            context: {
              slot: number;
            };
            value: {
              /** @description Must decode to exactly 32 bytes. */
              blockhash: string;
              lastValidBlockHeight: number;
            };
          },
        ]
      >;
    };
    CreatePayment: {
      usdCents: number;
      /** @description Opaque reference, not customer PII. */
      merchantReference: string;
    };
    Payment: {
      id: string;
      merchantReference: string;
      usdCents: number;
      lamports: string;
      displaySol: string;
      /** @constant */
      network: 'solana-devnet';
      /** @constant */
      asset: 'SOL';
      recipient: string;
      memo: string;
      /**
       * @deprecated
       * @description Legacy public Devnet URL only; never the configured provider URL. New checkout clients use authenticated POST /v1/checkout/{id}/rpc instead.
       */
      rpcUrl: string;
      quote: {
        usdPrice: string;
        blockId: number;
      };
      createdAt: number;
      expiresAt: number;
      /** @enum {string} */
      status: 'pending' | 'verifying' | 'settled' | 'expired';
      signature: string | null;
      settledAt: number | null;
      checkoutUrl?: string;
      attempts: {
        signature: string;
        /** @enum {string} */
        state: 'pending' | 'rejected' | 'verified';
        reason: string | null;
      }[];
    };
    PaymentEnvelope: {
      data: components['schemas']['Payment'];
      meta: {
        requestId: string;
      };
    };
    ErrorEnvelope: {
      error: {
        code: string;
        message: string;
        requestId: string;
        /**
         * @description Fixed configuration failure classification, returned only by GET /ready in dev. Never contains configuration values or upstream messages.
         * @enum {string}
         */
        diagnostic?:
          | 'APP_ENV_INVALID'
          | 'CHECKOUT_ORIGIN_INVALID'
          | 'RPC_URL_INVALID'
          | 'RPC_URL_NOT_HTTPS'
          | 'RPC_URL_HAS_CREDENTIALS'
          | 'MERCHANT_ENCRYPTION_KEYS_INVALID'
          | 'PRICE_KEY_MISSING'
          | 'CHECKOUT_SECRET_TOO_SHORT';
      };
    };
  };
  responses: {
    /** @description Authoritative payment state. Creation and merchant reads include checkoutUrl; checkout reads do not. */
    Payment: {
      content: {
        'application/json': components['schemas']['PaymentEnvelope'];
      };
    };
    /** @description 400/401/403/404/409/413/415/422/429/500/503. Retry provider failures safely; never infer payment failure from transport errors. */
    Error: {
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
  };
  parameters: {
    PaymentId: string;
  };
  requestBodies: never;
  headers: never;
  pathItems: never;
}

export type $defs = Record<string, never>;

export type external = Record<string, never>;

export interface operations {
  /** @description Public indicative SOL/USD reference from the payment pricing provider, not a locked payment quote. No payment is created or changed. Disabled when payments are disabled. No-store; limited to 6 requests per IP/minute and 60 globally/minute in addition to the general IP budget. fetchedAt is gateway retrieval time, not the time of the provider's last market update. */
  getReferencePrice: {
    responses: {
      /** @description Validated reference price and gateway retrieval time. */
      200: {
        content: {
          'application/json': components['schemas']['ReferencePriceEnvelope'];
        };
      };
      default: components['responses']['Error'];
    };
  };
  /** @description Dev-only operator acceptance check, available even when payments are disabled. Requires a server-side merchant credential, consumes rate-limit counters and emits one fixed synthetic failure with the returned request ID. Returns 500 SUPPORT_LOG_CHECK deliberately; never creates, submits or settles a payment or calls providers. Limited to one authenticated check per merchant per minute. Not available in local or production environments. No request body is read or logged. */
  checkSupportLogs: {
    responses: {
      500: components['responses']['Error'];
      default: components['responses']['Error'];
    };
  };
  createPayment: {
    parameters: {
      header: {
        'Idempotency-Key': string;
      };
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreatePayment'];
      };
    };
    responses: {
      200: components['responses']['Payment'];
      default: components['responses']['Error'];
    };
  };
  getPayment: {
    parameters: {
      path: {
        id: components['parameters']['PaymentId'];
      };
    };
    responses: {
      200: components['responses']['Payment'];
      default: components['responses']['Error'];
    };
  };
  getCheckout: {
    parameters: {
      path: {
        id: components['parameters']['PaymentId'];
      };
    };
    responses: {
      200: components['responses']['Payment'];
      default: components['responses']['Error'];
    };
  };
  /** @description Bounded read-only RPC for active unsettled payments. Only getGenesisHash with [] and getLatestBlockhash with [{commitment: finalized}]. No batches, notifications, arbitrary destinations or transaction submission. Limited to 12 requests per checkout/minute and 60 globally/minute in addition to existing limits. Provider failures are sanitized gateway errors. */
  checkoutRpc: {
    parameters: {
      path: {
        id: components['parameters']['PaymentId'];
      };
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CheckoutRpcRequest'];
      };
    };
    responses: {
      /** @description JSON-RPC 2.0 result, not a gateway data envelope. Provider credentials and extra fields are never returned. */
      200: {
        content: {
          'application/json': components['schemas']['CheckoutRpcResult'];
        };
      };
      default: components['responses']['Error'];
    };
  };
  submitTransaction: {
    parameters: {
      path: {
        id: components['parameters']['PaymentId'];
      };
    };
    requestBody: {
      content: {
        'application/json': {
          /** @description Must decode to exactly 64 bytes. */
          signature: string;
        };
      };
    };
    responses: {
      200: components['responses']['Payment'];
      default: components['responses']['Error'];
    };
  };
}
