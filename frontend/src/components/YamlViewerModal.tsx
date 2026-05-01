import { useEffect, useState } from 'react';
import { X, Copy, Check, FileCode } from 'lucide-react';

interface Props {
  open: boolean;
  namespace: string;
  name: string;
  yaml: string;
  loading: boolean;
  onClose: () => void;
}

function highlightYaml(text: string) {
  return text.split('\n').map((line, i) => {
    // comment
    const commentIdx = line.indexOf(' #');
    if (commentIdx >= 0) {
      const before = line.slice(0, commentIdx);
      const after = line.slice(commentIdx);
      return (
        <div key={i}>
          {renderLine(before)}
          <span className="text-emerald-600 dark:text-emerald-400">{after}</span>
        </div>
      );
    }
    return <div key={i}>{renderLine(line)}</div>;
  });
}

function renderLine(line: string) {
  const match = line.match(/^([\s\-]*)([^:#]+)(:)(\s*)(.*)$/);
  if (!match) {
    return <span className="text-gray-600 dark:text-gray-400">{line}</span>;
  }
  const [, indent, key, colon, space, value] = match;
  const val = value.trim();

  let valueClass = 'text-gray-600 dark:text-gray-400';
  if (/^(true|false)$/i.test(val)) valueClass = 'text-orange-500 dark:text-orange-400';
  else if (/^(null|~)$/.test(val)) valueClass = 'text-orange-500 dark:text-orange-400';
  else if (/^-?\d+(\.\d+)?$/.test(val)) valueClass = 'text-violet-500 dark:text-violet-400';
  else if (val.startsWith('"') || val.startsWith("'")) valueClass = 'text-amber-600 dark:text-amber-400';

  return (
    <>
      <span className="text-gray-400">{indent}</span>
      <span className="text-sky-600 dark:text-sky-400">{key}</span>
      <span className="text-gray-500">{colon}</span>
      <span className="text-gray-400">{space}</span>
      <span className={valueClass}>{value}</span>
    </>
  );
}

export function YamlViewerModal({ open, namespace, name, yaml, loading, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  if (!open) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-gray-300 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <FileCode size={16} className="text-sky-500" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{name}</p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">{namespace}</p>
          </div>
          <button
            onClick={copy}
            disabled={loading || !yaml}
            className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-30"
            title="Copy YAML"
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <p className="text-xs text-gray-500 text-center py-8">Loading deployment manifest…</p>
          ) : (
            <div className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap bg-gray-100 dark:bg-gray-950 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
              {highlightYaml(yaml)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
