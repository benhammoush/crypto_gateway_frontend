/**
 * Shared notice presentation without interpreting payment or availability state.
 * @packageDocumentation
 */

import type { ComponentPropsWithoutRef } from 'react';

/** Native paragraph attributes and an explicitly selected visual tone. */
interface NoticeProps extends ComponentPropsWithoutRef<'p'> {
  tone?: 'warning' | 'error' | 'success';
}

/** Render supplied content; the owner chooses announcement semantics and tone.
 * @param props - Native paragraph attributes, children and optional visual tone.
 * @returns A notice preserving the caller's role, content and other attributes.
 */
export function Notice(props: NoticeProps) {
  const { tone = 'warning', className = '', ...attributes } = props;
  return (
    <p
      {...attributes}
      className={`notice ${tone === 'warning' ? '' : tone} ${className}`.trim()}
    />
  );
}
