'use client';

import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import type { CodeEditorLanguage } from './code-editor-inner';

function EditorSkeleton({ minHeight }: { minHeight: number }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="h-7 w-24 rounded-sm bg-dockora-surface2" />
      </div>
      <div
        className={cn('dockora-code-editor animate-pulse rounded-md bg-dockora-surface2/80')}
        style={{ minHeight }}
      />
    </div>
  );
}

export const CodeEditor = dynamic(
  () => import('./code-editor-inner').then((m) => m.CodeEditorInner),
  {
    ssr: false,
    loading: () => <EditorSkeleton minHeight={280} />,
  },
);

export type { CodeEditorLanguage };
