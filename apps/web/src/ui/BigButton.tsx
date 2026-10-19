import type { ReactNode } from 'react';

/** Tone names are kept from v1; they map onto the design's palette (coral / sky / mint / violet / amber / cream). */
export type Tone = 'red' | 'blue' | 'green' | 'purple' | 'orange' | 'gray';

const TONE_CLASS: Record<Tone, string> = {
  red: 'coral',
  blue: 'sky',
  green: 'mint',
  purple: 'violet',
  orange: 'amber',
  gray: 'cream',
};

type Props = {
  /** Accessible name. Operation never depends on reading the visible text. */
  label: string;
  tone?: Tone;
  disabled?: boolean;
  pulse?: boolean;
  className?: string;
  onClick: () => void;
  testId?: string;
  children: ReactNode;
};

/** Large, icon-first, 3D "pressable" button (>= 64 px tall). */
export function BigButton({ label, tone = 'blue', disabled, pulse, className = '', onClick, testId, children }: Props) {
  return (
    <button
      type="button"
      className={`action action--${TONE_CLASS[tone]}${pulse ? ' pulse' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
