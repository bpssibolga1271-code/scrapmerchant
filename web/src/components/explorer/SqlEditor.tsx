'use client';

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { sql, StandardSQL } from '@codemirror/lang-sql';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';

export interface SqlEditorHandle {
  insertAtCursor: (text: string) => void;
}

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  disabled?: boolean;
  placeholder?: string;
  schema?: { name: string; type: string }[];
}

const editorTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    backgroundColor: '#fff',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: '#d97706',
    boxShadow: '0 0 0 2px rgba(217, 119, 6, 0.15)',
  },
  '.cm-content': {
    padding: '8px 0',
    fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
    minHeight: '80px',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-placeholder': {
    color: '#a1a1aa',
  },
  '.cm-selectionBackground': {
    backgroundColor: '#fef3c7 !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: '#fde68a !important',
  },
  '.cm-activeLine': {
    backgroundColor: '#fefce8',
  },
});

const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor({
  value,
  onChange,
  onExecute,
  disabled = false,
  placeholder = 'SELECT * FROM merchants WHERE ...',
  schema = [],
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);

  onChangeRef.current = onChange;
  onExecuteRef.current = onExecute;

  useImperativeHandle(ref, () => ({
    insertAtCursor(text: string) {
      const view = viewRef.current;
      if (!view) return;
      const pos = view.state.selection.main.head;
      view.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + text.length },
      });
      view.focus();
    },
  }));

  const buildSchemaCompletion = useCallback(() => {
    if (schema.length === 0) return {};
    const columns: Record<string, string[]> = {};
    columns['merchants'] = schema.map((c) => c.name);
    return { schema: { merchants: columns['merchants'] } };
  }, [schema]);

  useEffect(() => {
    if (!containerRef.current) return;

    const runKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          onExecuteRef.current();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const schemaComp = buildSchemaCompletion();

    const state = EditorState.create({
      doc: value,
      extensions: [
        runKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        history(),
        closeBrackets(),
        bracketMatching(),
        autocompletion(),
        sql({ dialect: StandardSQL, ...schemaComp }),
        syntaxHighlighting(defaultHighlightStyle),
        editorTheme,
        placeholderExt(placeholder),
        updateListener,
        EditorState.readOnly.of(disabled),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only recreate editor when schema or disabled changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, disabled]);

  // Sync external value changes (e.g. sample query clicks)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={containerRef} />;
});

export default SqlEditor;
