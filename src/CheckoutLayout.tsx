/**
 * Shared two-role demo layout and server-authoritative payment progress.
 * @packageDocumentation
 */
import type { ReactNode } from 'react';
import {
  ArrowDownOutlined,
  ArrowRightOutlined,
  Card,
  CheckOutlined,
  CopyOutlined,
  Flex,
  LinkOutlined,
  Select,
  Steps,
  SwapOutlined,
  Typography,
} from './design-system';
import type { Progress } from './types';

/** Layout inputs; business controls are omitted from customer-only routes. */
interface LayoutProps {
  business?: ReactNode;
  customer: ReactNode;
  checkoutUrl?: string;
  created: boolean;
  progress?: Progress;
  submitted?: boolean;
  verificationFailed?: boolean;
  progressAction?: ReactNode;
}

/** Render the role handoff and progress beneath both panels.
 * @param props - Presentation content and authoritative lifecycle state.
 * @returns A responsive demo or customer-only checkout.
 */
export function CheckoutLayout(props: LayoutProps) {
  const labels = [
    'Merchant creates checkout link',
    'Wallet approval',
    'On-chain verification',
  ];
  const descriptions = [
    'Payment request created',
    'Customer approves',
    'Gateway checks the payment',
  ];
  const verifying =
    props.submitted ||
    props.progress === 'Transaction submitted' ||
    props.progress === 'Verifying on-chain' ||
    props.progress === 'Payment verified';
  const current = !props.created ? 0 : verifying ? 2 : 1;
  return (
    <Flex vertical gap="middle" className="checkout-layout">
      <Flex
        component="header"
        justify="space-between"
        align="center"
        gap="small"
        wrap
      >
        <Typography.Link
          href="/"
          className="brand"
          aria-label="Pay with Solana"
        >
          <span className="brand-mark" aria-hidden="true">
            <SwapOutlined />
          </span>
          <span>
            <span className="brand-title" role="heading" aria-level={1}>
              Pay with <span>Solana</span>
            </span>
            <span className="brand-subtitle">
              Simple payments. Your wallet.
            </span>
          </span>
        </Typography.Link>
        <Flex align="center" gap="small" className="network-control">
          <Typography.Text type="secondary" className="network-label">
            Network
          </Typography.Text>
          <Select
            aria-label="Network"
            value="devnet"
            disabled={props.created}
            options={[
              { value: 'devnet', label: 'Devnet' },
              {
                value: 'mainnet',
                label: 'Mainnet (unavailable)',
                disabled: true,
              },
            ]}
          />
        </Flex>
      </Flex>
      <div className={props.business ? 'role-layout' : 'customer-layout'}>
        {props.business && (
          <>
            <section aria-label="Business">
              <Typography.Text className="role-label" type="secondary">
                BUSINESS
              </Typography.Text>
              {props.business}
            </section>
            <section
              aria-label="Checkout link handoff"
              className={`handoff${props.created ? '' : ' handoff-waiting'}`}
            >
              <div className="handoff-arrow" aria-hidden="true">
                <ArrowRightOutlined className="arrow-horizontal" />
                <ArrowDownOutlined className="arrow-vertical" />
              </div>
              <Card size="small" className="handoff-card">
                <Flex vertical gap="small">
                  <span className="panel-icon" aria-hidden="true">
                    <LinkOutlined />
                  </span>
                  <Typography.Text strong>Checkout link</Typography.Text>
                  <Typography.Text
                    type="secondary"
                    ellipsis
                    className="handoff-path"
                  >
                    {props.checkoutUrl
                      ? new URL(props.checkoutUrl).pathname
                      : '—'}
                  </Typography.Text>
                  {props.checkoutUrl ? (
                    <Typography.Text
                      className="handoff-copy"
                      copyable={{
                        text: props.checkoutUrl,
                        tooltips: ['Copy link', 'Link copied'],
                        icon: [
                          <span key="copy">
                            <CopyOutlined /> Copy link
                          </span>,
                          <span key="copied">
                            <CheckOutlined /> Copied
                          </span>,
                        ],
                      }}
                    />
                  ) : (
                    <Typography.Text
                      disabled
                      className="handoff-copy-placeholder"
                    >
                      Copy link
                    </Typography.Text>
                  )}
                  <Typography.Text type="secondary" className="handoff-hint">
                    {props.created
                      ? 'Share with your customer'
                      : 'Create a payment link first'}
                  </Typography.Text>
                </Flex>
              </Card>
            </section>
          </>
        )}
        <section aria-label="Customer">
          {props.business && (
            <Typography.Text className="role-label" type="secondary">
              CUSTOMER
            </Typography.Text>
          )}
          <div className={props.submitted ? 'submitted-panel' : undefined}>
            {props.customer}
          </div>
        </section>
      </div>
      <Card
        size="small"
        title="Payment progress"
        className="progress-card"
        extra={props.progressAction}
      >
        <div role="list" aria-label="Payment progress" aria-live="polite">
          <Steps
            size="small"
            labelPlacement="vertical"
            current={current}
            status={
              props.verificationFailed
                ? 'error'
                : props.progress === 'Payment verified'
                  ? 'finish'
                  : 'process'
            }
            items={labels.map((label, index) => ({
              description: descriptions[index],
              title: (
                <span
                  role="listitem"
                  aria-label={label}
                  aria-current={index === current ? 'step' : undefined}
                >
                  {label}
                </span>
              ),
            }))}
          />
        </div>
      </Card>
    </Flex>
  );
}
