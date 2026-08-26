'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { indentUnit, syntaxHighlighting, HighlightStyle, LanguageSupport } from '@codemirror/language';
import { EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { Button } from '@/components/ui/form-controls';
import { cn } from '@/lib/utils';
import { dotenvLanguage } from '@/lib/dotenv-language';
import { formatComposeYaml, formatEnvFile } from '@/lib/format-yaml';

export type CodeEditorLanguage = 'yaml' | 'env';

const yamlHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#8888aa', fontStyle: 'italic' },
  { tag: t.lineComment, color: '#8888aa', fontStyle: 'italic' },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: '#ff006e' },
  { tag: t.string, color: '#00b4d8' },
  { tag: t.number, color: '#ffd60a' },
  { tag: [t.bool, t.null, t.keyword], color: '#06d6a0' },
  { tag: t.atom, color: '#c77dff' },
  { tag: [t.separator, t.punctuation], color: '#6b6b88' },
  { tag: t.operator, color: '#8338ec' },
  { tag: t.invalid, color: '#ff5400', textDecoration: 'underline' },
  { tag: t.meta, color: '#8338ec' },
  { tag: t.variableName, color: '#4cc9f0' },
  { tag: t.labelName, color: '#ff006e' },
]);

const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--dockora-text)',
      fontSize: '13px',
      fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    '.cm-content': {
      caretColor: 'var(--dockora-pink)',
      fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--dockora-pink)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(255, 0, 110, 0.28)',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(131, 56, 236, 0.08)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(131, 56, 236, 0.12)',
    },
    '.cm-gutters': {
      backgroundColor: 'rgba(10, 10, 15, 0.65)',
      color: 'var(--dockora-muted)',
      borderRight: '1px solid var(--dockora-border)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '2.4rem',
      padding: '0 0.5rem',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'transparent',
      border: '1px solid var(--dockora-border)',
      color: 'var(--dockora-muted)',
    },
    '.cm-matchingBracket': {
      outline: '1px solid var(--dockora-blue)',
      backgroundColor: 'rgba(0, 180, 216, 0.12)',
    },
    '.cm-placeholder': {
      color: 'var(--dockora-muted)',
    },
  },
  { dark: true },
);

export function CodeEditorInner({
  value,
  onChange,
  language,
  disabled,
  placeholder,
  minHeight = 280,
  formatLabel,
  formatFailed,
  leading,
}: {
  value: string;
  onChange: (next: string) => void;
  language: CodeEditorLanguage;
  disabled?: boolean;
  placeholder?: string;
  minHeight?: number;
  formatLabel: string;
  formatFailed: string;
  leading?: ReactNode;
}) {
  const [formatError, setFormatError] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const applyFormat = useCallback(() => {
    const result =
      language === 'yaml' ? formatComposeYaml(valueRef.current) : formatEnvFile(valueRef.current);
    if (!result.ok) {
      setFormatError(formatFailed.replace('{message}', result.error));
      return false;
    }
    setFormatError(null);
    if (result.text !== valueRef.current) onChangeRef.current(result.text);
    return true;
  }, [formatFailed, language]);

  const extensions = useMemo(
    () => [
      language === 'yaml' ? yaml() : new LanguageSupport(dotenvLanguage),
      indentUnit.of('  '),
      editorTheme,
      syntaxHighlighting(yamlHighlight),
      indentationMarkers({
        highlightActiveBlock: true,
        hideFirstIndent: true,
        markerType: 'codeOnly',
        thickness: 1,
        colors: {
          dark: 'rgba(131, 56, 236, 0.38)',
          light: 'rgba(131, 56, 236, 0.28)',
          activeDark: '#ff006e',
          activeLight: '#ff006e',
        },
      }),
      Prec.high(
        keymap.of([
          {
            key: 'Alt-Shift-f',
            preventDefault: true,
            run: () => {
              applyFormat();
              return true;
            },
          },
        ]),
      ),
    ],
    [applyFormat, language],
  );

  return (
    <div className="space-y-2">
      <div
        className={
          leading
            ? 'flex flex-wrap items-center justify-between gap-2'
            : 'flex flex-wrap items-center justify-end gap-2'
        }
      >
        <div className="flex flex-wrap gap-2">{leading}</div>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => void applyFormat()}
          title="Alt+Shift+F"
        >
          {formatLabel}
        </Button>
      </div>
      {formatError ? <p className="text-xs text-dockora-danger">{formatError}</p> : null}
      <div
        className={cn(
          'dockora-code-editor overflow-hidden rounded-md',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        <CodeMirror
          value={value}
          onChange={(next) => {
            setFormatError(null);
            onChange(next);
          }}
          theme="none"
          placeholder={placeholder}
          editable={!disabled}
          readOnly={disabled}
          indentWithTab
          minHeight={`${minHeight}px`}
          maxHeight="70vh"
          basicSetup={{
            lineNumbers: true,
            foldGutter: language === 'yaml',
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            indentOnInput: true,
            syntaxHighlighting: false,
            autocompletion: false,
            tabSize: 2,
            bracketMatching: true,
            closeBrackets: true,
            searchKeymap: true,
          }}
          extensions={extensions}
        />
      </div>
    </div>
  );
}
