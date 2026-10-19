import { afterEach, expect, it, vi } from "vitest";
import { request } from "../src/api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("uses same-origin checkout status, signature and RPC in dev only", async () => {
  vi.resetModules();
  vi.stubEnv("VITE_APP_ENV", "dev");
  vi.stubGlobal("window", {
    location: { origin: "https://crypto-gateway-dev.vercel.app" },
  });
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ data: { id: "fixture" } }),
  );
  vi.stubGlobal("fetch", fetcher);
  const api = await import("../src/api");
  expect(api.checkoutRpcUrl("fixture")).toBe(
    "https://crypto-gateway-dev.vercel.app/api/gateway/v1/checkout/fixture/rpc",
  );
  await api.paymentStatus("fixture", "checkout-token");
  await api.submitSignature("fixture", "checkout-token", "signature");
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://crypto-gateway-dev.vercel.app/api/gateway/v1/checkout/fixture",
  );
  expect(fetcher.mock.calls[1][0]).toBe(
    "https://crypto-gateway-dev.vercel.app/api/gateway/v1/checkout/fixture/transactions",
  );
});

it.each(["local", "production"])(
  "retains direct configured API transport in %s",
  async (mode) => {
    vi.resetModules();
    vi.stubEnv("VITE_APP_ENV", mode);
    vi.stubEnv("VITE_API_ORIGIN", "https://configured.example");
    const api = await import("../src/api");
    expect(api.checkoutRpcUrl("fixture")).toBe(
      "https://configured.example/v1/checkout/fixture/rpc",
    );
  },
);

it("combines caller cancellation with the request deadline for stalled polling", async () => {
  const caller = new AbortController();
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  let activeSignal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          activeSignal = init.signal!;
          activeSignal.addEventListener(
            "abort",
            () => reject(activeSignal!.reason),
            { once: true },
          );
        }),
    ),
  );
  const pending = request("http://localhost/fixture", {
    signal: caller.signal,
  });
  const assertion = expect(pending).rejects.toThrow("deadline");
  expect(activeSignal).not.toBe(caller.signal);
  deadline.abort(new Error("deadline"));
  await assertion;
  expect(caller.signal.aborted).toBe(false);
  expect(activeSignal?.aborted).toBe(true);
});
