/** Non-actionable checkout geometry shared by the demo and initial status load.
 * @packageDocumentation
 */
import {
  Button,
  Card,
  Descriptions,
  Flex,
  Typography,
  WalletOutlined,
} from './design-system';

/** Presentation state while no authoritative quote is available. */
interface CheckoutPlaceholderProps {
  loading?: boolean;
}

/** Reserve the same summary, details and action space before a quote is available.
 * @param props - Whether a created checkout is awaiting its first status response.
 * @returns A disabled customer card without invented quote values.
 */
export function CheckoutPlaceholder(props: CheckoutPlaceholderProps) {
  return (
    <Card
      size="small"
      className="checkout-card"
      aria-busy={props.loading}
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
        <div className="checkout-summary">
          <div className="checkout-amounts">
            <div>
              <Typography.Text type="secondary" className="amount-label">
                Cart total
              </Typography.Text>
              <Typography.Title
                level={3}
                className="amount-total"
                style={{ margin: 0 }}
              >
                — <Typography.Text type="secondary">USD</Typography.Text>
              </Typography.Title>
            </div>
            <div>
              <Typography.Text type="secondary" className="amount-label">
                You pay
              </Typography.Text>
              <Typography.Title
                level={3}
                className="amount-total"
                style={{ margin: 0 }}
              >
                — <Typography.Text type="secondary">SOL</Typography.Text>
              </Typography.Title>
            </div>
          </div>
          <Flex
            align="center"
            justify="space-between"
            gap={8}
            wrap
            className="checkout-quote"
          >
            <Typography.Text type="secondary" className="exchange-rate">
              Locked rate · —
            </Typography.Text>
            <Typography.Text type="secondary" className="quote-timer">
              Quote locked · —
            </Typography.Text>
          </Flex>
        </div>
        <Descriptions
          size="small"
          className="checkout-details"
          column={1}
          items={[
            { key: 'network', label: 'Network', children: 'Solana Devnet' },
            { key: 'recipient', label: 'Recipient', children: '—' },
          ]}
        />
        <Flex vertical align="center" className="checkout-actions">
          <Button type="primary" size="large" disabled>
            {props.loading ? 'Loading checkout…' : 'Connect wallet'}
          </Button>
        </Flex>
        <div className="payment-reference">
          <Typography.Text type="secondary">Payment reference</Typography.Text>
          <Typography.Text
            type="secondary"
            role={props.loading ? 'status' : undefined}
          >
            {props.loading ? 'Loading payment…' : '—'}
          </Typography.Text>
        </div>
      </Flex>
    </Card>
  );
}
