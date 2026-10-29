// @vitest-environment jsdom
/** Standard Ant Design components preserve explicit feedback and Solana presentation.
 * @packageDocumentation
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import {
  Address,
  Alert,
  BrowserLink,
  CryptoPrice,
} from '../../src/design-system';

afterEach(cleanup);

it('keeps informational feedback separate from error announcements', () => {
  render(
    <>
      <Alert role="status" type="info" message="Checking availability" />
      <Alert role="alert" type="warning" message="Do not pay again" />
    </>,
  );
  expect(screen.getByRole('status').textContent).toBe('Checking availability');
  expect(screen.getByRole('alert').textContent).toBe('Do not pay again');
});

it('displays the full Solana recipient without an Ethereum prefix', () => {
  const address = 'So11111111111111111111111111111111111111112';
  render(
    <Address
      address={address}
      addressPrefix={false}
      ellipsis={false}
      copyable
    />,
  );
  expect(screen.getByText(address)).toBeTruthy();
  expect(document.body.textContent).not.toContain('0x');
  expect(screen.getByRole('button', { name: /copy/i })).toBeTruthy();
});

it('displays exact lamports as SOL without Ethereum units or number coercion', () => {
  render(
    <CryptoPrice
      value={9007199254740993n}
      decimals={9}
      symbol="SOL"
      icon={false}
      format={() => '9007199.254740993 SOL'}
    />,
  );
  expect(document.body.textContent).toContain('9007199.254740993');
  expect(document.body.textContent).toContain('SOL');
  expect(document.body.textContent).not.toContain('ETH');
});

it('links transaction evidence to explicit Solana Devnet rather than the EVM default', () => {
  const signature = '1'.repeat(64);
  const href = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  render(
    <BrowserLink
      address={signature}
      addressPrefix={false}
      href={href}
      name="View transaction"
      icon={<span aria-hidden="true">↗</span>}
      target="_blank"
      rel="noopener noreferrer"
    />,
  );
  const link = screen.getByRole<HTMLAnchorElement>('link', {
    name: 'View transaction',
  });
  expect(link.href).toBe(href);
  expect(link.rel).toBe('noopener noreferrer');
});
