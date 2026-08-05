'use client';

import { cn } from '@/lib/utils';

const variants = {
  default:
    'border border-dockora-border bg-dockora-surface text-dockora-text hover:border-dockora-accent hover:text-dockora-accent',
  primary:
    'border border-dockora-accent bg-dockora-accent text-dockora-accentFg hover:brightness-110',
  danger:
    'border border-dockora-danger bg-transparent text-dockora-danger hover:bg-dockora-danger hover:text-white',
  ghost: 'border border-transparent text-dockora-muted hover:text-dockora-accent',
} as const;

export function Button({
  variant = 'default',
  className,
  disabled,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-dockora-border bg-dockora-surface px-3 py-2 text-sm outline-none focus:border-dockora-accent',
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'rounded-lg border border-dockora-border bg-dockora-surface px-3 py-2 text-sm outline-none focus:border-dockora-accent',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-dockora-border bg-dockora-surface px-3 py-2 text-sm outline-none focus:border-dockora-accent',
        className,
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1 block text-xs font-medium text-dockora-muted', className)}
      {...props}
    />
  );
}
