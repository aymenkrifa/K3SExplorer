import { useEffect, useState } from 'react';
import { X, Save, Trash2, Plus, AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  kind: 'configmap' | 'secret' | null;
  namespace: string;
  name: string;
  data: Record<string, string>;
  loading: boolean;
  onClose: () => void;
  onSave: (data: Record<string, string>) => void;
}

export function ResourceEditorModal({ open, kind, namespace, name, data, loading, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<[string, string][]>([]);

  useEffect(() => {
    if (open) {
      setDraft(Object.entries(data));
    }
  }, [open, data]);

  if (!open || !kind) return null;

  const isSecret = kind === 'secret';

  function updateKey(index: number, key: string) {
    setDraft((prev) => prev.map(([k, v], i) => (i === index ? [key, v] : [k, v])));
  }

  function updateValue(index: number, value: string) {
    setDraft((prev) => prev.map(([k, v], i) => (i === index ? [k, value] : [k, v])));
  }

  function removeRow(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setDraft((prev) => [...prev, ['', '']]);
  }

  function handleSave() {
    const obj: Record<string, string> = {};
    for (const [k, v] of draft) {
      if (k.trim()) obj[k.trim()] = v;
    }
    onSave(obj);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-xl border border-gray-800 bg-gray-900 shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <span className={`w-2 h-2 rounded-full shrink-0 ${isSecret ? 'bg-orange-400' : 'bg-sky-400'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{isSecret ? 'Secret' : 'ConfigMap'}: {name}</p>
            <p className="text-[10px] text-gray-500">{namespace}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Warning for secrets */}
        {isSecret && (
          <div className="flex items-center gap-2 px-4 py-2 bg-orange-900/20 border-b border-orange-900/30">
            <AlertTriangle size={12} className="text-orange-400 shrink-0" />
            <p className="text-[10px] text-orange-300">
              Values will be base64-encoded when saved.
            </p>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading ? (
            <p className="text-xs text-gray-500 text-center py-4">Loading…</p>
          ) : draft.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">No data entries</p>
          ) : (
            draft.map(([k, v], index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={k}
                  onChange={(e) => updateKey(index, e.target.value)}
                  placeholder="Key"
                  className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-sky-600"
                />
                <input
                  value={v}
                  onChange={(e) => updateValue(index, e.target.value)}
                  placeholder="Value"
                  className="flex-[2] min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-sky-600"
                />
                <button
                  onClick={() => removeRow(index)}
                  className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
                  title="Remove"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
          <button
            onClick={addRow}
            className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            <Plus size={12} />
            Add entry
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-sky-700 text-white rounded hover:bg-sky-600 transition-colors disabled:opacity-50"
            >
              <Save size={12} />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
