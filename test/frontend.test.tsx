// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { parseUsd, paymentStatus, submitSignature } from "../src/api";
import { Checkout } from "../src/App";
import { Payment, PROGRESS } from "../src/types";
import { sendPayment, WalletSubmissionUncertain } from "../src/wallet";

vi.mock("../src/api", async (original) => ({
  ...(await original<typeof import("../src/api")>()),
  paymentStatus: vi.fn(),
  submitSignature: vi.fn(),
}));
vi.mock("../src/wallet", async (original) => ({
  ...(await original<typeof import("../src/wallet")>()),
  sendPayment: vi.fn(),
}));

const payment: Payment = {
  id: "fixture-payment",
  merchantReference: "reference",
  usdCents: 1000,
  lamports: "100000000",
  displaySol: "0.100000000",
  network: "solana-devnet",
  asset: "SOL",
  recipient: "recipient",
  memo: "memo",
  rpcUrl: "https://api.devnet.solana.com",
  createdAt: Date.now(),
  quote: { usdPrice: "100", blockId: 123 },
  settledAt: null,
  expiresAt: Date.now() + 900_000,
  status: "pending",
  signature: null,
  attempts: [],
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("reference form", () => {
  it("parses USD without floating-point rounding", () => {
    expect(parseUsd("10.01")).toBe(1001);
    expect(parseUsd("0.29")).toBe(29);
    expect(parseUsd("10000")).toBe(1_000_000);
    for (const value of ["0", "-1", "1.001", "1e2", "10000.01"])
      expect(() => parseUsd(value)).toThrow();
  });
});

describe("checkout", () => {
  it("blocks a second transfer after uncertain wallet submission", async () => {
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(sendPayment).mockRejectedValue(
      new WalletSubmissionUncertain(
        "Check wallet activity before paying again.",
      ),
    );
    render(<Checkout id={payment.id} token="token" />);
    fireEvent.click(await screen.findByText("Pay with Phantom"));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Check wallet activity before paying again.",
    );
    expect(screen.queryByText("Pay with Phantom")).toBeNull();
  });
  it("does not open the wallet if the reload guard cannot be persisted", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(sendPayment).mockResolvedValue("signature");
    vi.mocked(submitSignature).mockRejectedValue(
      new Error("network unavailable"),
    );
    render(<Checkout id={payment.id} token="token" />);
    fireEvent.click(await screen.findByText("Pay with Phantom"));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Enable session storage before submitting a payment safely.",
    );
    expect(sendPayment).not.toHaveBeenCalled();
  });
  it("blocks another transfer after reloading with the wallet promise still pending", async () => {
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(sendPayment).mockImplementation(
      () => new Promise<string>(() => {}),
    );
    const first = render(<Checkout id={payment.id} token="token" />);
    fireEvent.click(await screen.findByText("Pay with Phantom"));
    await waitFor(() => expect(sendPayment).toHaveBeenCalledOnce());
    expect(
      sessionStorage.getItem(
        `crypto_gateway:signature:${payment.id}:uncertain`,
      ),
    ).toBe("true");
    first.unmount();
    render(<Checkout id={payment.id} token="token" />);
    await screen.findByRole("alert");
    expect(screen.queryByText("Pay with Phantom")).toBeNull();
    expect(sendPayment).toHaveBeenCalledOnce();
  });
  it("contains exactly the four agreed notifications", () => {
    expect(PROGRESS).toEqual([
      "Awaiting wallet approval",
      "Transaction submitted",
      "Verifying on-chain",
      "Payment verified",
    ]);
  });
  it("does not treat wallet submission as verified payment", async () => {
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(sendPayment).mockResolvedValue("signature");
    vi.mocked(submitSignature).mockResolvedValue({
      ...payment,
      status: "verifying",
    });
    render(<Checkout id={payment.id} token="token" />);
    fireEvent.click(await screen.findByText("Pay with Phantom"));
    await waitFor(() =>
      expect(
        screen.getByText("Verifying on-chain").getAttribute("aria-current"),
      ).toBe("step"),
    );
    expect(
      screen.getByText("Payment verified").getAttribute("aria-current"),
    ).toBeNull();
  });
  it("shows verified only from backend settlement", async () => {
    vi.mocked(paymentStatus).mockResolvedValue({
      ...payment,
      status: "settled",
      signature: "signature",
    });
    render(<Checkout id={payment.id} token="token" />);
    expect(
      await screen.findByText(
        "Verified testnet transfer. No real funds were used.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Payment verified").getAttribute("aria-current"),
    ).toBe("step");
  });
  it("resubmits a saved signature after refresh without prompting another transfer", async () => {
    sessionStorage.setItem(
      `crypto_gateway:signature:${payment.id}`,
      "signature",
    );
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(submitSignature).mockResolvedValue({
      ...payment,
      status: "verifying",
    });
    render(<Checkout id={payment.id} token="token" />);
    await waitFor(() =>
      expect(submitSignature).toHaveBeenCalledWith(
        payment.id,
        "token",
        "signature",
      ),
    );
    expect(screen.queryByText("Pay with Phantom")).toBeNull();
    expect(sendPayment).not.toHaveBeenCalled();
  });
  it("does not describe loss of connectivity as failed payment", async () => {
    vi.mocked(paymentStatus).mockRejectedValue(new Error("network"));
    render(<Checkout id={payment.id} token="token" />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Unable to refresh payment status. Your payment has not been marked failed.",
    );
  });
  it("does not offer a new transfer for an expired quote", async () => {
    vi.mocked(paymentStatus).mockResolvedValue({
      ...payment,
      status: "expired",
      expiresAt: Date.now() - 1,
    });
    render(<Checkout id={payment.id} token="token" />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This quote has expired. Do not send a new transfer. If you already paid, contact the merchant.",
    );
    expect(screen.queryByText("Pay with Phantom")).toBeNull();
  });
});
