/**
 * Compact customer checkout and dismissible, read-only transaction receipt.
 * @packageDocumentation
 */
import { useRef, type ReactNode } from 'react';
import {
  Address,
  Alert,
  Button,
  Card,
  CheckOutlined,
  Descriptions,
  Flex,
  Modal,
  ReloadOutlined,
  SwapOutlined,
  Tag,
  Typography,
  WalletOutlined,
} from './design-system';
import { CheckoutLayout } from './CheckoutLayout';
import type { Payment, Progress } from './types';

/** Server state and guarded actions supplied by the checkout lifecycle. */
interface PaymentViewProps {
  id: string;
  payment?: Payment;
  progress?: Progress;
  signature?: string;
  remaining: number;
  canPay: boolean;
  busy: boolean;
  walletAddress: string;
  connecting: boolean;
  /** Ask the wallet to connect without preparing a transfer. */
  connect: () => void;
  /** Request one guarded wallet approval. */
  pay: () => void;
  modalOpen: boolean;
  /** Change receipt visibility without changing payment state.
   * @param open - Whether the receipt should be shown.
   */
  setModalOpen: (open: boolean) => void;
  business?: ReactNode;
  checkoutUrl?: string;
  /** Refresh gateway state without asking the wallet to send anything. */
  refresh: () => void;
  children: ReactNode;
}

/** Present the quote separately from the transaction's backend-confirmed result.
 * @param props - Lifecycle state; closing the modal never changes payment guards.
 * @returns Customer controls, shared progress and a transaction modal.
 */
export function PaymentView(props: PaymentViewProps) {
  const reopen = useRef<HTMLButtonElement>(null);
  const p = props.payment;
  const verified = p?.status === 'settled';
  const submitted = !!props.signature || p?.status === 'verifying' || verified;
  const rejected =
    !verified &&
    p?.attempts.some(
      (attempt) =>
        attempt.signature === props.signature && attempt.state === 'rejected',
    );
  const title = verified
    ? 'Payment verified'
    : rejected
      ? 'Payment not verified'
      : props.progress === 'Verifying on-chain'
        ? 'Verifying payment'
        : 'Transaction submitted';
  const usd = p ? `$${(p.usdCents / 100).toFixed(2)} USD` : '— USD';
  const customer = (
    <Card
      className="checkout-card"
      size="small"
      title={
        <Flex align="center" gap="small">
          <span className="panel-icon" aria-hidden="true">
            <WalletOutlined />
          </span>
          <span role="heading" aria-level={2}>
            Review &amp; pay
          </span>
        </Flex>
      }
    >
      <Flex vertical gap="small">
        {p ? (
          <>
            <div aria-label="Payment summary">
              <Flex vertical gap={4}>
                <Flex align="center" justify="space-between" gap="small" wrap>
                  <Typography.Text type="secondary">Cart total</Typography.Text>
                  <Tag
                    color={
                      verified
                        ? 'success'
                        : p.status === 'expired'
                          ? 'warning'
                          : 'blue'
                    }
                  >
                    {verified
                      ? 'Verified'
                      : submitted
                        ? 'Submitted'
                        : p.status === 'expired'
                          ? 'Expired'
                          : 'Pending'}
                  </Tag>
                </Flex>
                <Typography.Title
                  level={3}
                  className="amount-total"
                  style={{ margin: 0 }}
                >
                  ${(p.usdCents / 100).toFixed(2)}{' '}
                  <Typography.Text type="secondary">USD</Typography.Text>
                </Typography.Title>
                <Typography.Text type="secondary">
                  {p.displaySol} SOL
                </Typography.Text>
                {!submitted &&
                  p.status === 'pending' &&
                  props.remaining > 0 && (
                    <Typography.Text type="secondary">
                      Quote locked · {Math.floor(props.remaining / 60)}:
                      {String(props.remaining % 60).padStart(2, '0')}
                    </Typography.Text>
                  )}
              </Flex>
            </div>
            <Descriptions
              size="small"
              className="checkout-details"
              column={1}
              items={[
                { key: 'network', label: 'Network', children: 'Solana Devnet' },
                {
                  key: 'recipient',
                  label: 'Recipient',
                  children: (
                    <Address
                      className="address"
                      address={p.recipient}
                      addressPrefix={false}
                      ellipsis
                      copyable
                    />
                  ),
                },
              ]}
            />
            {!submitted && props.canPay && (
              <>
                {props.walletAddress && (
                  <Typography.Text type="secondary" className="address">
                    Connected:{' '}
                    <Address
                      address={props.walletAddress}
                      addressPrefix={false}
                      ellipsis
                    />
                  </Typography.Text>
                )}
                <Flex gap="small">
                  <Button
                    block
                    onClick={props.connect}
                    loading={props.connecting}
                    disabled={
                      props.busy || props.connecting || !!props.walletAddress
                    }
                  >
                    Connect wallet
                  </Button>
                  <Button
                    block
                    type="primary"
                    onClick={props.pay}
                    loading={props.busy}
                    disabled={props.busy || !props.walletAddress}
                  >
                    Pay with SOL
                  </Button>
                </Flex>
              </>
            )}
            {submitted && (
              <Button block disabled>
                {verified ? 'Payment verified' : 'Payment submitted'}
              </Button>
            )}
          </>
        ) : (
          <Typography.Text type="secondary">Loading payment…</Typography.Text>
        )}
        <Typography.Text type="secondary" className="address payment-reference">
          Payment reference {props.id}
        </Typography.Text>
      </Flex>
    </Card>
  );
  return (
    <>
      <CheckoutLayout
        business={props.business}
        checkoutUrl={props.checkoutUrl}
        created
        progress={props.progress}
        submitted={submitted}
        verificationFailed={rejected}
        customer={customer}
        progressAction={
          <Flex align="center" gap={4} wrap>
            {submitted && (
              <Button
                ref={reopen}
                type="text"
                size="small"
                onClick={() => props.setModalOpen(true)}
              >
                View payment status
              </Button>
            )}
            {!verified && !(submitted && props.modalOpen) && (
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                disabled={props.busy}
                onClick={props.refresh}
              >
                Refresh status
              </Button>
            )}
          </Flex>
        }
      />
      <Flex vertical gap="small" className="checkout-feedback">
        {!(submitted && props.modalOpen) && props.children}
      </Flex>
      <Modal
        title={
          <Flex align="center" gap="small">
            <span
              className={`status-icon${verified ? ' status-icon-success' : ''}`}
              aria-hidden="true"
            >
              {verified ? <CheckOutlined /> : <SwapOutlined />}
            </span>
            <span>{title}</span>
          </Flex>
        }
        open={submitted && props.modalOpen}
        onCancel={() => props.setModalOpen(false)}
        centered
        width={420}
        destroyOnHidden
        footer={
          <Flex justify="space-between" align="center" gap="small">
            {!verified ? (
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                disabled={props.busy}
                onClick={props.refresh}
              >
                Refresh status
              </Button>
            ) : (
              <Typography.Text type="secondary">
                Confirmed by the backend
              </Typography.Text>
            )}
            <Button onClick={() => props.setModalOpen(false)}>Close</Button>
          </Flex>
        }
        focusTriggerAfterClose={false}
        afterClose={() => reopen.current?.focus()}
      >
        <Flex vertical gap="middle">
          <Alert
            role="status"
            type={verified ? 'success' : rejected ? 'warning' : 'info'}
            showIcon
            message={
              verified
                ? 'The backend confirmed your payment.'
                : rejected
                  ? 'This transfer could not be verified. Contact the merchant before paying again.'
                  : 'Your payment was sent. Waiting for verification.'
            }
          />
          <Descriptions
            size="small"
            className="receipt-details"
            column={1}
            items={[
              {
                key: 'amount',
                label: verified ? 'Amount paid' : 'Submitted amount',
                children: `${p?.displaySol ?? '—'} SOL`,
              },
              { key: 'usd', label: 'Cart total', children: usd },
              { key: 'network', label: 'Network', children: 'Solana Devnet' },
            ]}
          />
          {props.signature && (
            <Flex vertical gap="small">
              <Typography.Text type="secondary">Transaction ID</Typography.Text>
              <Typography.Text
                className="address"
                copyable={{ text: props.signature }}
              >
                {props.signature.slice(0, 8)}…{props.signature.slice(-8)}
              </Typography.Text>
              <Typography.Link
                href={`https://explorer.solana.com/tx/${encodeURIComponent(props.signature)}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View transaction on Solana Explorer ↗
              </Typography.Link>
            </Flex>
          )}
          {props.modalOpen && props.children}
        </Flex>
      </Modal>
    </>
  );
}
