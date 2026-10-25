// @vitest-environment jsdom
/**
 * Notice presentation preserves caller-owned semantics and native attributes.
 * @packageDocumentation
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Notice } from '../../src/design-system';

afterEach(cleanup);

it('keeps the caller-selected alert role, content and native attributes', () => {
  render(
    <Notice tone="error" role="alert" id="feedback" className="extra">
      Check the supplied amount.
    </Notice>,
  );
  const notice = screen.getByRole('alert');
  expect(notice.tagName).toBe('P');
  expect(notice.id).toBe('feedback');
  expect(notice.classList.contains('notice')).toBe(true);
  expect(notice.classList.contains('error')).toBe(true);
  expect(notice.classList.contains('extra')).toBe(true);
  expect(notice.textContent).toBe('Check the supplied amount.');
});

it('does not invent an announcement role or payment state for a visual tone', () => {
  render(<Notice tone="success">Supplied content</Notice>);
  const notice = screen.getByText('Supplied content');
  expect(notice.classList.contains('success')).toBe(true);
  expect(notice.hasAttribute('role')).toBe(false);
});
