// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import App from "../src/App";
import { request } from "../src/api";

vi.mock("../src/api", async (original) => ({
  ...(await original<typeof import("../src/api")>()),
  request: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/** Disabled form controls alone must not be the submission guard. */
function submit() {
  fireEvent.submit(
    screen.getByRole("button", { name: /^Pay$/ }).closest("form")!,
  );
}

describe("server-reported demo availability", () => {
  it("blocks payment while the initial status check is pending", () => {
    vi.mocked(request).mockImplementation(() => new Promise(() => {}));
    render(<App />);
    expect(screen.getByRole("status").textContent).toBe(
      "Checking demo availability…",
    );
    expect(
      (
        screen.getByRole("button", {
          name: /^Pay$/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Amount in USD") as HTMLInputElement).disabled,
    ).toBe(true);
    submit();
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "/api/demo/status",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("shows disabled mode and never posts a payment, including a synthetic form submit", async () => {
    vi.mocked(request).mockResolvedValue({ enabled: false });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Demo payments are disabled.",
      ),
    );
    expect(
      (
        screen.getByRole("button", {
          name: /^Pay$/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    submit();
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([null, {}, { enabled: "true" }, { enabled: 1 }])(
    "fails closed on malformed status %j",
    async (value) => {
      vi.mocked(request).mockResolvedValue(value);
      render(<App />);
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toContain(
          "Demo availability could not be checked.",
        ),
      );
      expect(
        (
          screen.getByRole("button", {
            name: /^Pay$/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      submit();
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it("fails closed on a network error without exposing its message", async () => {
    vi.mocked(request).mockRejectedValue(
      new Error("private-provider-diagnostic"),
    );
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Demo availability could not be checked.",
      ),
    );
    expect(document.body.textContent).not.toContain(
      "private-provider-diagnostic",
    );
    submit();
    expect(request).toHaveBeenCalledOnce();
  });

  it("enables the existing form only for literal true without automatically creating a payment", async () => {
    vi.mocked(request).mockResolvedValue({ enabled: true });
    const view = render(<App />);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: /^Pay$/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(request).toHaveBeenCalledOnce();
    const signal = vi.mocked(request).mock.calls[0][1]!.signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("shows sanitized creation diagnostics without retrying automatically or changing the same-amount retry key", async () => {
    const message =
      "Unable to create payment. Retry with the same amount. Diagnostic: RPC_UNAVAILABLE. Request ID: 22222222-2222-4222-8222-222222222222.";
    vi.mocked(request)
      .mockResolvedValueOnce({ enabled: true })
      .mockRejectedValue(new Error(message));
    render(<App />);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /^Pay$/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    submit();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(message),
    );
    expect(request).toHaveBeenCalledTimes(2);
    const first = vi.mocked(request).mock.calls[1][1]!;
    submit();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(vi.mocked(request).mock.calls[2][1]).toMatchObject({
      headers: first.headers,
      body: first.body,
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(message),
    );
  });
});
