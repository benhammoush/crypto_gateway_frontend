/**
 * Matching non-interactive overlays for waiting and locked demo panels.
 * @packageDocumentation
 */
import {
  Card,
  ClockCircleOutlined,
  Flex,
  LockOutlined,
  Typography,
} from './design-system';

/** Presentation state; never determines payment settlement. */
interface PanelStatusProps {
  state: 'waiting' | 'created';
}

/** Render one visual template with state-specific icon and copy.
 * @param props - Whether the customer is waiting or the business form is locked.
 * @returns A status card outside the underlying inert panel content.
 */
export function PanelStatus(props: PanelStatusProps) {
  const waiting = props.state === 'waiting';
  return (
    <div className="panel-status" role="status">
      <Card size="small" className="panel-status-card">
        <Flex vertical align="center" gap={6}>
          <span className="status-icon" aria-hidden="true">
            {waiting ? <ClockCircleOutlined /> : <LockOutlined />}
          </span>
          <Typography.Text strong>
            {waiting
              ? 'Waiting for checkout creation'
              : 'Created · amount locked'}
          </Typography.Text>
          <Typography.Text type="secondary">
            {waiting
              ? 'Create a payment link to continue.'
              : 'Your payment link is ready to share.'}
          </Typography.Text>
        </Flex>
      </Card>
    </div>
  );
}
