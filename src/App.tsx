/**
 * Merchant example and checkout lifecycle with guarded wallet submission.
 * @packageDocumentation
 */

import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  parseUsd,
  paymentStatus,
  request,
  submitSignature,
} from './api';
import { Payment, Progress } from './types';
import {
  sendPayment,
  connectWallet,
  walletDiagnostic,
  walletFailureDetails,
  WalletNotSubmitted,
  WalletSubmissionUncertain,
} from './wallet';
import { readSession, removeSession, saveSession } from './storage';
import { CheckoutLayout } from './CheckoutLayout';
import { PaymentView } from './PaymentView';
import { PanelStatus } from './PanelStatus';
import {
  Alert,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Result,
  ReloadOutlined,
  ShoppingCartOutlined,
  Typography,
  WalletOutlined,
} from './design-system';

const MAX_POLLS = 180;

/** Payment identity and tab-scoped capability needed to render checkout. */
interface CheckoutProps {
  id: string;
  token: string;
  business?: ReactNode;
  checkoutUrl?: string;
}

/** Render the merchant example and create a checkout through the server-side adapter.
 * @returns The amount form and its availability or failure state.
 */
function Demo() {
  const [amount, setAmount] = useState('10.00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<{ cents: number; key: string }>();
  const [checkout, setCheckout] = useState<{
    id: string;
    token: string;
    url: string;
  }>();
  const creating = useRef(false);
  const [availability, setAvailability] = useState<
    'checking' | 'enabled' | 'disabled' | 'unavailable'
  >('checking');

  useEffect(() => {
    const controller = new AbortController();
    void request<{ enabled: boolean }>('/api/demo/status', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((status) => {
        if (controller.signal.aborted) return;
        setAvailability(
          typeof status.enabled === 'boolean'
            ? status.enabled
              ? 'enabled'
              : 'disabled'
            : 'unavailable',
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability('unavailable');
      });
    return () => controller.abort();
  }, []);

  /** Create a payment from validated input and activate the inline customer checkout.
   * @param event - Submission event whose default navigation must be prevented.
   */
  async function pay(event: FormEvent) {
    event.preventDefault();
    if (creating.current || checkout || availability !== 'enabled') return;
    creating.current = true;
    setError('');
    setBusy(true);
    try {
      const cents = parseUsd(amount);
      const key = retry?.cents === cents ? retry.key : crypto.randomUUID();
      setRetry({ cents, key });
      const result = await request<{ checkoutUrl: string }>(
        '/api/demo/payments',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': key,
          },
          body: JSON.stringify({ usdCents: cents }),
        },
      );
      const destination = new URL(result.checkoutUrl);
      if (
        destination.origin !== location.origin ||
        destination.search ||
        destination.username ||
        destination.password ||
        !/^\/checkout\/[a-f0-9-]{36}$/.test(destination.pathname)
      )
        throw new Error(
          'The demo returned an unexpected checkout destination.',
        );
      const capability = destination.hash.slice(1);
      if (!/^[a-f0-9]{64}$/.test(capability))
        throw new Error('The demo returned an invalid checkout link.');
      const id = destination.pathname.slice('/checkout/'.length);
      if (!saveSession(`crypto_gateway:session:${id}`, capability))
        throw new Error(
          'Enable session storage before opening a checkout safely.',
        );
      setCheckout({ id, token: capability, url: destination.href });
      history.replaceState(null, '', destination.pathname);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to create payment.',
      );
    } finally {
      creating.current = false;
      setBusy(false);
    }
  }

  const business = (
    <div className="panel-frame">
      <div
        className={checkout ? 'locked-panel' : undefined}
        {...(checkout ? { inert: '' } : {})}
      >
        <Card
          className="checkout-card"
          size="small"
          styles={{
            header: { paddingBlock: 12 },
            title: { whiteSpace: 'normal' },
          }}
          title={
            <Flex align="center" gap="small">
              <span className="panel-icon" aria-hidden="true">
                <ShoppingCartOutlined />
              </span>
              <span role="heading" aria-level={2}>
                Customer’s cart
              </span>
            </Flex>
          }
        >
          <Flex vertical gap="small">
            <Typography.Paragraph type="secondary" className="cart-explanation">
              In a real store, it comes automatically from the customer’s cart.
            </Typography.Paragraph>
            <form onSubmit={(event) => void pay(event)}>
              <Form component={false} layout="vertical">
                <Form.Item
                  label="Cart total (USD)"
                  htmlFor="amount"
                  style={{ marginBottom: 14 }}
                >
                  <Input
                    id="amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    disabled={!!checkout || busy || availability !== 'enabled'}
                    autoComplete="off"
                    required
                    prefix="$"
                    suffix="USD"
                  />
                </Form.Item>
                <Button
                  block
                  type="primary"
                  htmlType="submit"
                  aria-label={
                    busy ? 'Creating payment link…' : 'Create payment link'
                  }
                  aria-busy={busy}
                  loading={busy}
                  disabled={!!checkout || busy || availability !== 'enabled'}
                >
                  {busy ? 'Creating payment link…' : 'Create payment link'}
                </Button>
              </Form>
            </form>
            {availability !== 'enabled' && (
              <Alert
                role="status"
                type="info"
                message={
                  availability === 'checking'
                    ? 'Checking demo availability…'
                    : availability === 'disabled'
                      ? 'Demo payments are disabled.'
                      : 'Demo availability could not be checked. Payments remain unavailable; reload to try again.'
                }
              />
            )}
            {error && <Alert type="error" role="alert" message={error} />}
          </Flex>
        </Card>
      </div>
      {checkout && <PanelStatus state="created" />}
    </div>
  );
  return checkout ? (
    <Checkout
      id={checkout.id}
      token={checkout.token}
      checkoutUrl={checkout.url}
      business={business}
    />
  ) : (
    <CheckoutLayout
      business={business}
      created={false}
      progressAction={
        <Button type="text" size="small" icon={<ReloadOutlined />} disabled>
          Refresh status
        </Button>
      }
      customer={
        <div className="panel-frame">
          <div className="locked-panel" {...{ inert: '' }}>
            <Card
              title={
                <Flex align="center" gap="small">
                  <span className="panel-icon" aria-hidden="true">
                    <WalletOutlined />
                  </span>
                  <span>Review &amp; pay</span>
                </Flex>
              }
              size="small"
              className="checkout-card"
            >
              <Flex vertical gap="small">
                <Typography.Text type="secondary">Cart total</Typography.Text>
                <Typography.Title
                  level={3}
                  className="amount-total"
                  style={{ margin: 0 }}
                >
                  — USD
                </Typography.Title>
                <Typography.Text>— SOL</Typography.Text>
                <Typography.Text type="secondary">
                  Quote expires in —
                </Typography.Text>
                <Typography.Text type="secondary">
                  Network · Solana Devnet
                </Typography.Text>
                <Typography.Text type="secondary">Recipient —</Typography.Text>
                <Flex gap="small">
                  <Button disabled block>
                    Connect wallet
                  </Button>
                  <Button disabled block>
                    Pay with SOL
                  </Button>
                </Flex>
                <Typography.Text type="secondary">Reference —</Typography.Text>
              </Flex>
            </Card>
          </div>
          <PanelStatus state="waiting" />
        </div>
      }
    />
  );
}

/** Checkout state is server-authoritative; wallet messages never imply settlement.
 * @param props - Payment identifier and the checkout capability retained for this tab.
 * @returns Payment details, wallet controls and backend-confirmed progress.
 */
export function Checkout(props: CheckoutProps) {
  const { id, token } = props;
  const [walletAddress, setWalletAddress] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [modalOpen, setModalOpen] = useState(true);
  const submitting = useRef(false);
  const connectionPending = useRef(false);
  const [payment, setPayment] = useState<Payment>();
  const [progress, setProgress] = useState<Progress>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const [now, setNow] = useState(Date.now());
  const savedKey = `crypto_gateway:signature:${id}`;
  const candidate = useRef(readSession(savedKey));
  const terminal = useRef(false);
  const [uncertain, setUncertain] = useState(
    readSession(`${savedKey}:uncertain`) === 'true',
  );
  const [diagnostic, setDiagnostic] = useState(() =>
    walletDiagnostic(readSession(`${savedKey}:walletDiagnostic`)),
  );
  const [walletFailure, setWalletFailure] = useState(() =>
    import.meta.env.VITE_APP_ENV === 'dev'
      ? walletFailureDetails(readSession(`${savedKey}:walletFailure`))
      : undefined,
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    /** Refresh payment state and submit a saved candidate signature when verification has not recorded it yet. */
    async function poll() {
      try {
        const current = await paymentStatus(id, token, controller.signal);
        if (controller.signal.aborted || terminal.current) return;
        setPayment(current);
        if (current.status === 'settled') {
          terminal.current = true;
          setProgress('Payment verified');
          setMessage('');
          removeSession(savedKey);
          removeSession(`${savedKey}:uncertain`);
          removeSession(`${savedKey}:walletDiagnostic`);
          removeSession(`${savedKey}:walletFailure`);
          return;
        }
        const signature = candidate.current;
        const attempt = current.attempts.find((entry) =>
          signature
            ? entry.signature === signature
            : entry.state === 'rejected',
        );
        if (signature && !attempt) {
          setProgress('Transaction submitted');
          await submitSignature(id, token, signature);
        } else if (current.status === 'verifying') {
          setProgress('Verifying on-chain');
          setMessage('');
        } else if (attempt?.state === 'rejected') {
          setProgress(undefined);
          setMessage(
            'This transfer could not be verified. Contact the merchant before sending another payment.',
          );
          return;
        } else if (current.status === 'expired') {
          setProgress(undefined);
          setMessage(
            'This quote has expired. Do not send a new transfer. If you already paid, contact the merchant.',
          );
          return;
        }
      } catch (error) {
        if (controller.signal.aborted || terminal.current) return;
        setMessage(
          'Unable to refresh payment status. Your payment has not been marked failed.' +
            (error instanceof ApiError ? error.supportReference : ''),
        );
      }
      if (!controller.signal.aborted && ++polls < MAX_POLLS)
        timer = setTimeout(() => void poll(), 5000);
      else if (!controller.signal.aborted)
        setMessage(
          'Automatic updates paused. Refresh status to continue tracking.',
        );
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, token, savedKey, round]);

  /**
   * Guard wallet submission with uncertainty until the returned signature is saved.
   * The candidate signature then continues preventing duplicate payment during verification.
   */
  async function pay() {
    if (
      !payment ||
      !walletAddress ||
      submitting.current ||
      candidate.current ||
      uncertain ||
      payment.attempts.length > 0 ||
      payment.status !== 'pending' ||
      payment.expiresAt <= Date.now()
    )
      return;
    submitting.current = true;
    setBusy(true);
    setMessage('');
    setProgress('Awaiting wallet approval');
    let submitted = false;
    try {
      // Guard BEFORE opening the wallet: it may broadcast before its promise
      // resolves, and a reload in that window must not offer another transfer.
      if (!saveSession(`${savedKey}:uncertain`, 'true')) {
        throw new WalletNotSubmitted(
          'Enable session storage before submitting a payment safely.',
        );
      }
      setUncertain(true);
      const signature = await sendPayment(payment, token, walletAddress);
      submitted = true;
      candidate.current = signature;
      if (saveSession(savedKey, signature)) {
        removeSession(`${savedKey}:uncertain`);
        setUncertain(false);
      }
      setProgress('Transaction submitted');
      setModalOpen(true);
      const current = await submitSignature(id, token, signature);
      if (!terminal.current) {
        setPayment(current);
        if (current.status === 'settled') {
          terminal.current = true;
          setProgress('Payment verified');
        } else if (current.status === 'verifying')
          setProgress('Verifying on-chain');
        else {
          setProgress(undefined);
          setMessage(
            'This transfer could not be verified. Contact the merchant before sending another payment.',
          );
        }
      }
      setRound((value) => value + 1);
    } catch (error) {
      if (error instanceof WalletSubmissionUncertain) {
        const code = walletDiagnostic(error.diagnosticCode);
        setDiagnostic(code);
        if (code) saveSession(`${savedKey}:walletDiagnostic`, code);
        if (import.meta.env.VITE_APP_ENV === 'dev') {
          const details = walletFailureDetails(error.details);
          setWalletFailure(details);
          if (details)
            saveSession(`${savedKey}:walletFailure`, JSON.stringify(details));
        }
      }
      if (error instanceof WalletNotSubmitted) {
        removeSession(`${savedKey}:uncertain`);
        setUncertain(false);
      }
      if (!submitted) setProgress(undefined);
      setMessage(
        submitted
          ? 'Your transaction was submitted. Refresh status; do not pay again.' +
              (error instanceof ApiError ? error.supportReference : '')
          : error instanceof Error
            ? error.message
            : 'Wallet approval was not completed.',
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const remaining = payment
    ? Math.max(0, Math.ceil((payment.expiresAt - now) / 1000))
    : 0;
  const canPay =
    payment?.status === 'pending' &&
    remaining > 0 &&
    !candidate.current &&
    payment.attempts.length === 0 &&
    !uncertain;
  /** Connect Phantom without requesting a transfer or changing payment recovery state. */
  async function connect() {
    if (connectionPending.current || submitting.current || !canPay) return;
    connectionPending.current = true;
    setConnecting(true);
    setMessage('');
    try {
      setWalletAddress(await connectWallet());
    } catch {
      setMessage(
        'Unable to connect Phantom. Open or install Phantom and try again. No payment was requested.',
      );
    } finally {
      connectionPending.current = false;
      setConnecting(false);
    }
  }
  return (
    <PaymentView
      id={id}
      payment={payment}
      progress={progress}
      signature={
        payment?.signature ??
        candidate.current ??
        payment?.attempts[0]?.signature
      }
      remaining={remaining}
      canPay={canPay}
      busy={busy}
      walletAddress={walletAddress}
      connecting={connecting}
      connect={() => void connect()}
      pay={() => void pay()}
      modalOpen={modalOpen}
      setModalOpen={setModalOpen}
      business={props.business}
      checkoutUrl={props.checkoutUrl}
      refresh={() => {
        setMessage('');
        setRound((value) => value + 1);
      }}
    >
      {message && <Alert type="warning" role="alert" message={message} />}
      {uncertain && !busy && !message && progress !== 'Payment verified' && (
        <Alert
          type="warning"
          role="alert"
          message="Wallet submission is uncertain. Check wallet activity and contact the merchant before paying again."
        />
      )}
      {uncertain && !busy && progress !== 'Payment verified' && (
        <Alert
          type="info"
          role="status"
          message={
            <>
              Wallet diagnostic: <code>{diagnostic ?? 'UNAVAILABLE'}</code>.
              This does not confirm whether a transfer was submitted.
              <br />
              Wallet API check: request{' '}
              {typeof window.phantom?.solana?.request === 'function'
                ? 'available'
                : 'unavailable'}
              ; direct sender{' '}
              {window.phantom?.solana &&
              'signAndSendTransaction' in window.phantom.solana &&
              typeof window.phantom.solana.signAndSendTransaction === 'function'
                ? 'available'
                : 'unavailable'}
              .
              {import.meta.env.VITE_APP_ENV === 'dev' && walletFailure && (
                <>
                  <br />
                  Dev wallet hint: <code>{walletFailure.reason}</code>.
                  <br />
                  Wallet wait: {walletFailure.walletSeconds}s. Time since
                  blockhash fetched: {walletFailure.blockhashSeconds}s.
                  <br />
                  Quote expired at error:{' '}
                  {walletFailure.quoteExpired ? 'yes' : 'no'}. These details do
                  not prove submission or the cause.
                </>
              )}
            </>
          }
        />
      )}
    </PaymentView>
  );
}

/** Select the merchant example or the capability-bearing checkout route.
 * @returns The application shell with the selected checkout or merchant view.
 */
export default function App() {
  const match = /^\/checkout\/([a-f0-9-]{36})$/.exec(location.pathname);
  let token = '';
  if (match) {
    const key = `crypto_gateway:session:${match[1]}`;
    const fragment = location.hash.slice(1);
    if (/^[a-f0-9]{64}$/.test(fragment)) {
      if (saveSession(key, fragment))
        history.replaceState(null, '', location.pathname);
      token = fragment;
    }
    token ||= readSession(key) ?? '';
  }
  return (
    <div className="shell">
      <main>
        {match ? (
          token ? (
            <Checkout id={match[1]} token={token} />
          ) : (
            <Card className="checkout-card">
              <Result
                status="warning"
                title="Session unavailable."
                subTitle="Reopen the original checkout link from your application."
              />
            </Card>
          )
        ) : (
          <Demo />
        )}
      </main>
      <Flex
        component="footer"
        align="center"
        justify="space-between"
        gap="small"
        wrap
      >
        <Typography.Text type="secondary">
          USD → SOL · Non-custodial
        </Typography.Text>
        <Typography.Link
          href="https://ant.design"
          target="_blank"
          rel="noopener noreferrer"
        >
          UI built with Ant Design
        </Typography.Link>
      </Flex>
    </div>
  );
}
