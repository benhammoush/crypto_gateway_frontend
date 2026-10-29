// @vitest-environment jsdom
/** Three visual stages and matching non-interactive panel status templates.
 * @packageDocumentation
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CheckoutLayout } from '../../src/CheckoutLayout';
import { PanelStatus } from '../../src/PanelStatus';
import type { Progress } from '../../src/types';

afterEach(cleanup);

it.each([
  {
    created: false,
    progress: undefined,
    current: 'Merchant creates checkout link',
  },
  { created: true, progress: undefined, current: 'Wallet approval' },
  {
    created: true,
    progress: 'Awaiting wallet approval',
    current: 'Wallet approval',
  },
  {
    created: true,
    progress: 'Transaction submitted',
    current: 'On-chain verification',
  },
  {
    created: true,
    progress: 'Verifying on-chain',
    current: 'On-chain verification',
  },
  {
    created: true,
    progress: 'Payment verified',
    current: 'On-chain verification',
  },
] satisfies {
  created: boolean;
  progress: Progress | undefined;
  current: string;
}[])(
  'maps $progress to $current without repeating receipt statuses',
  ({ created, progress, current }) => {
    render(
      <CheckoutLayout
        customer={<div>Customer checkout</div>}
        created={created}
        progress={progress}
      />,
    );
    const list = screen.getByRole('list', { name: 'Payment progress' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(list.querySelector('[aria-current="step"]')?.textContent).toBe(
      current,
    );
    expect(list.textContent).not.toMatch(
      /Transaction submitted|Payment verified/,
    );
    expect(list.querySelectorAll('.ant-steps-item-finish')).toHaveLength(
      progress === 'Payment verified'
        ? 3
        : current === 'On-chain verification'
          ? 2
          : created
            ? 1
            : 0,
    );
  },
);

it.each([
  [
    'waiting',
    'Waiting for checkout creation',
    'Create a payment link to continue.',
  ],
  [
    'created',
    'Created · amount locked',
    'Your payment link is ready to share.',
  ],
] as const)(
  'uses the same status-card template for %s',
  (state, title, detail) => {
    render(<PanelStatus state={state} />);
    const status = screen.getByRole('status');
    expect(status.querySelector('.panel-status-card')).toBeTruthy();
    expect(within(status).getByText(title)).toBeTruthy();
    expect(within(status).getByText(detail)).toBeTruthy();
    expect(within(status).queryByRole('button')).toBeNull();
  },
);
