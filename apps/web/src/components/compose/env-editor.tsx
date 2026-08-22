'use client';

import { useMemo, useState } from 'react';
import { isSecretEnvKey, parseEnvFile, serializeEnvFile, type EnvEntry } from '@/lib/env-file';
import { Button, Input } from '@/components/ui/form-controls';
import { CodeEditor } from '@/components/compose/code-editor';

export function EnvEditor({
  value,
  onChange,
  disabled,
  placeholder,
  defaultMode = 'raw',
  labels,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** `raw` = einfügen; `fields` = vorhandene Keys nachbearbeiten */
  defaultMode?: 'fields' | 'raw';
  labels: {
    fields: string;
    raw: string;
    key: string;
    value: string;
    show: string;
    hide: string;
    remove: string;
    empty: string;
    format: string;
    formatFailed: string;
  };
}) {
  const [mode, setMode] = useState<'fields' | 'raw'>(defaultMode);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const entries = useMemo(() => parseEnvFile(value), [value]);
  const pairCount = entries.filter((entry) => entry.kind === 'pair').length;

  const update = (next: EnvEntry[]) => onChange(serializeEnvFile(next));

  const setPair = (index: number, patch: { key?: string; value?: string }) => {
    const next = entries.map((entry, i) => {
      if (i !== index || entry.kind !== 'pair') return entry;
      return { ...entry, ...patch };
    });
    update(next);
  };

  const modeButtons = (
    <>
      <Button
        size="sm"
        variant={mode === 'fields' ? 'primary' : 'default'}
        onClick={() => setMode('fields')}
      >
        {labels.fields}
      </Button>
      <Button
        size="sm"
        variant={mode === 'raw' ? 'primary' : 'default'}
        onClick={() => setMode('raw')}
      >
        {labels.raw}
      </Button>
    </>
  );

  return (
    <div className="space-y-3">
      {mode === 'raw' ? (
        <CodeEditor
          language="env"
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          minHeight={280}
          formatLabel={labels.format}
          formatFailed={labels.formatFailed}
          leading={modeButtons}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">{modeButtons}</div>
          {pairCount === 0 ? (
            <p className="text-sm text-dockora-muted">{labels.empty}</p>
          ) : (
            <div className="space-y-2">
              {entries.map((entry, index) =>
                entry.kind === 'other' ? (
                  <p
                    key={`other-${index}`}
                    className="font-mono text-xs text-dockora-muted whitespace-pre-wrap"
                  >
                    {entry.raw || ' '}
                  </p>
                ) : (
                  <div key={`pair-${index}`} className="flex flex-wrap items-center gap-2">
                    <Input
                      value={entry.key}
                      onChange={(e) => setPair(index, { key: e.target.value })}
                      disabled={disabled}
                      spellCheck={false}
                      className="w-40 font-mono text-sm sm:w-52"
                      aria-label={labels.key}
                      placeholder={labels.key}
                    />
                    <Input
                      type={
                        isSecretEnvKey(entry.key) && !revealed[index] ? 'password' : 'text'
                      }
                      value={entry.value}
                      onChange={(e) => setPair(index, { value: e.target.value })}
                      disabled={disabled}
                      spellCheck={false}
                      autoComplete="off"
                      className="min-w-[12rem] flex-1 font-mono text-sm"
                      aria-label={labels.value}
                      placeholder={labels.value}
                    />
                    {isSecretEnvKey(entry.key) ? (
                      <Button
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                          setRevealed((prev) => ({ ...prev, [index]: !prev[index] }))
                        }
                      >
                        {revealed[index] ? labels.hide : labels.show}
                      </Button>
                    ) : null}
                    {disabled ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => update(entries.filter((_, i) => i !== index))}
                      >
                        {labels.remove}
                      </Button>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
