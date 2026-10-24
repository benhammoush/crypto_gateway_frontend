/**
 * Gateway transport, public errors and monetary-input regressions.
 * @packageDocumentation
 */

import { afterEach, expect, it, vi } from "vitest";
import { request } from "../../src/api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
