export interface paths {
  '/v1/payments': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['createPayment'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/payments/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getPayment'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/checkout/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getCheckout'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/checkout/{id}/rpc': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Bounded read-only RPC for active unsettled payments. Only getGenesisHash with [] and getLatestBlockhash with [{commitment: finalized}]. No batches, notifications, arbitrary destinations or transaction submission. Limited to 12 requests per checkout/minute and 60 globally/minute in addition to existing limits. Provider failures are sanitized gateway errors. */
    post: operations['checkoutRpc'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/checkout/{id}/transactions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['submitTransaction'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    RpcId: string | number;
    CheckoutRpcRequest: {
      /** @constant */
      jsonrpc: '2.0';
      id: components['schemas']['RpcId'];
      /** @enum {string} */
      method: 'getGenesisHash' | 'getLatestBlockhash';
      params: unknown[];
    } & (
      | {
          /** @constant */
          method?: 'getGenesisHash';
          params?: unknown[];
        }
      | {
          /** @constant */
          method?: 'getLatestBlockhash';
          params?: {
            /** @constant */
            commitment: 'finalized';
          }[];
        }
    );
    CheckoutRpcResult: {
      /** @constant */
      jsonrpc: '2.0';
      id: components['schemas']['RpcId'];
      result:
        | 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
        | {
            context: {
              slot: number;
            };
            value: {
              /** @description Must decode to exactly 32 bytes. */
              blockhash: string;
              lastValidBlockHeight: number;
            };
          };
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
      };
    };
  };
  responses: {
    /** @description Authoritative payment state. Creation and merchant reads include checkoutUrl; checkout reads do not. */
    Payment: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['PaymentEnvelope'];
      };
    };
    /** @description 400/401/403/404/409/413/415/422/429/500/503. Retry provider failures safely; never infer payment failure from transport errors. */
    Error: {
      headers: {
        [name: string]: unknown;
      };
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
export interface operations {
  createPayment: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': string;
      };
      path?: never;
      cookie?: never;
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
      query?: never;
      header?: never;
      path: {
        id: components['parameters']['PaymentId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: components['responses']['Payment'];
      default: components['responses']['Error'];
    };
  };
  getCheckout: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: components['parameters']['PaymentId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: components['responses']['Payment'];
      default: components['responses']['Error'];
    };
  };
  checkoutRpc: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: components['parameters']['PaymentId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CheckoutRpcRequest'];
      };
    };
    responses: {
      /** @description JSON-RPC 2.0 result, not a gateway data envelope. Provider credentials and extra fields are never returned. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CheckoutRpcResult'];
        };
      };
      default: components['responses']['Error'];
    };
  };
  submitTransaction: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: components['parameters']['PaymentId'];
      };
      cookie?: never;
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
