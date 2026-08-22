'use client';

import { useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/form-controls';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  consequences?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  consequences,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="dockora-panel w-full max-w-md space-y-4 p-5 shadow-neon outline-none"
      >
        <div className="space-y-2">
          <h2 id={titleId} className="dockora-title-gradient text-xl">
            {title}
          </h2>
          {description ? <p className="text-sm text-dockora-muted">{description}</p> : null}
          {consequences && consequences.length > 0 ? (
            <ul className="mt-2 space-y-1.5 border border-dockora-border bg-black/30 px-3 py-2.5 text-sm text-dockora-muted">
              {consequences.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="text-dockora-pink" aria-hidden>
                    •
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {children}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? 'danger' : 'primary'}
            disabled={busy}
            className={cn(busy && 'opacity-70')}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
