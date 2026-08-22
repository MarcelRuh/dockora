'use client';

import { cn } from '@/lib/utils';

const variants = {
  default:
    'border border-[rgba(131,56,236,0.4)] bg-white/[0.04] text-dockora-text hover:border-dockora-pink hover:text-white hover:shadow-neon-pink',
  primary:
    'border border-transparent bg-gradient-to-br from-dockora-pink to-dockora-purple text-white shadow-neon hover:shadow-neon-strong hover:brightness-110',
  danger:
    'border border-dockora-danger/70 bg-dockora-danger/5 text-dockora-danger hover:bg-dockora-danger hover:text-white hover:shadow-[0_0_16px_rgba(255,84,0,0.4)]',
  ghost: 'border border-transparent text-dockora-muted hover:border-[rgba(131,56,236,0.35)] hover:text-dockora-text',
} as const;

const sizes = {
  sm: 'h-7 px-2 text-[10px] tracking-[0.1em]',
  md: 'h-10 px-4 text-[11px] tracking-[0.14em]',
} as const;

/** Shared button chrome – also used for Link-as-button styling */
export function buttonClassName({
  variant = 'default',
  size = 'md',
  className,
}: {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  className?: string;
} = {}) {
  return cn(
    'inline-flex shrink-0 items-center justify-center font-display font-semibold uppercase transition-[color,background-color,border-color,box-shadow,filter] disabled:cursor-not-allowed disabled:opacity-40',
    variants[variant],
    sizes[size],
    className,
  );
}

const fieldBase =
  'dockora-field h-10 px-3.5 text-sm leading-none';

export function Button({
  variant = 'default',
  size = 'md',
  className,
  disabled,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, 'w-full min-w-0', className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, 'dockora-select min-w-[9rem]', className)} {...props}>
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
        'dockora-field w-full min-h-[6rem] resize-y px-3.5 py-2.5 text-sm leading-relaxed',
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
      className={cn(
        'mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-dockora-blue',
        className,
      )}
      {...props}
    />
  );
}

/** NeonVerse filter / toolbar strip around inputs & selects */
export function FilterBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('dockora-field-group items-center gap-2.5', className)}>{children}</div>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 flex-1 space-y-1', className)}>
      {label ? <Label>{label}</Label> : null}
      {children}
    </div>
  );
}
