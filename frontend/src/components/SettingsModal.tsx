import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, Settings as SettingsIcon, Star } from 'lucide-react';

export interface DeploymentGroup {
  id: string;
  name: string;
  patterns: string[]; // deployment names
  color: string;
}

export interface AppSettings {
  defaultNamespace: string;
  autoExpandPods: boolean;
  logTailLines: number;
  groups: DeploymentGroup[];
  defaultGroupId?: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultNamespace: 'all',
  autoExpandPods: true,
  logTailLines: 200,
  groups: [],
  defaultGroupId: undefined,
};

const COLORS = [
  'bg-rose-600',
  'bg-orange-600',
  'bg-amber-600',
  'bg-emerald-600',
  'bg-sky-600',
  'bg-indigo-600',
  'bg-violet-600',
  'bg-pink-600',
];

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('k3s-settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem('k3s-settings', JSON.stringify(s));
}

interface Props {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  namespaces: string[];
  deployments?: { name: string; namespace: string }[];
  onRequestDeployments?: () => Promise<void>;
  focusGroupId?: string | null;
}

export function SettingsModal({ open, onClose, settings, onChange, namespaces, deployments, onRequestDeployments, focusGroupId }: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [groupDrafts, setGroupDrafts] = useState<Record<string, DeploymentGroup>>({});
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [loadingDeployments, setLoadingDeployments] = useState(false);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setGroupDrafts({});
      setEditingGroupId(null);
      setLoadingDeployments(false);
    }
  }, [open, settings]);

  useEffect(() => {
    if (focusGroupId && groupRefs.current[focusGroupId]) {
      groupRefs.current[focusGroupId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [open, focusGroupId]);

  if (!open) return null;

  function update(partial: Partial<AppSettings>) {
    setDraft((prev) => ({ ...prev, ...partial }));
  }

  function addGroup() {
    const id = crypto.randomUUID();
    setDraft((prev) => ({
      ...prev,
      groups: [
        ...prev.groups,
        { id, name: 'New Group', patterns: [], color: COLORS[prev.groups.length % COLORS.length] },
      ],
    }));
  }

  function removeGroup(id: string) {
    setDraft((prev) => ({ ...prev, groups: prev.groups.filter((g) => g.id !== id) }));
    setGroupDrafts((prev) => { const n = { ...prev }; delete n[id]; return n; });
    if (editingGroupId === id) setEditingGroupId(null);
  }

  function getGroup(id: string): DeploymentGroup {
    return groupDrafts[id] ?? draft.groups.find((g) => g.id === id)!;
  }

  function updateGroupDraft(id: string, partial: Partial<DeploymentGroup>) {
    setGroupDrafts((prev) => {
      const base = prev[id] ?? draft.groups.find((g) => g.id === id)!;
      return { ...prev, [id]: { ...base, ...partial } };
    });
  }

  async function startEditingGroup(groupId: string) {
    const group = draft.groups.find((g) => g.id === groupId);
    if (!group) return;
    setGroupDrafts((prev) => ({ ...prev, [groupId]: { ...group } }));
    setEditingGroupId(groupId);
    if (!deployments?.length && onRequestDeployments) {
      setLoadingDeployments(true);
      await onRequestDeployments();
      setLoadingDeployments(false);
    }
  }

  function saveGroupEdit(id: string) {
    const edited = groupDrafts[id];
    if (!edited) return;
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === id ? edited : g)),
    }));
    setGroupDrafts((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setEditingGroupId(null);
  }

  function cancelGroupEdit(id: string) {
    setGroupDrafts((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setEditingGroupId(null);
  }

  function apply() {
    onChange(draft);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-2xl w-[540px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
            <SettingsIcon size={16} />
            <span className="font-semibold text-sm">Settings</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* General */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">General</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-700 dark:text-gray-300">Default namespace</label>
                <select
                  value={draft.defaultNamespace}
                  onChange={(e) => update({ defaultNamespace: e.target.value })}
                  className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-sky-600"
                >
                  {namespaces.map((ns) => (
                    <option key={ns} value={ns}>{ns}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-700 dark:text-gray-300">Auto-expand pods</label>
                <button
                  onClick={() => update({ autoExpandPods: !draft.autoExpandPods })}
                  className={`w-10 h-5 rounded-full transition-colors relative ${
                    draft.autoExpandPods ? 'bg-sky-600' : 'bg-gray-700'
                  }`}
                  aria-checked={draft.autoExpandPods}
                  role="switch"
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      draft.autoExpandPods ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-700 dark:text-gray-300">Log tail lines</label>
                <input
                  type="number"
                  min={10}
                  max={5000}
                  value={draft.logTailLines}
                  onChange={(e) => update({ logTailLines: Math.max(10, Math.min(5000, parseInt(e.target.value) || 200)) })}
                  className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 rounded px-2 py-1.5 w-20 focus:outline-none focus:border-sky-600"
                />
              </div>
            </div>
          </section>

          {/* Deployment Groups */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Deployment Groups</h3>
              <button
                onClick={addGroup}
                className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 transition-colors"
              >
                <Plus size={12} />
                Add group
              </button>
            </div>

            <div className="space-y-2">
              {draft.groups.length === 0 && (
                <p className="text-xs text-gray-600 italic">No groups yet. Create one to filter deployments quickly.</p>
              )}
              {draft.groups.map((group) => {
                const isEditing = editingGroupId === group.id;
                const hasDraft = group.id in groupDrafts;
                const working = hasDraft ? groupDrafts[group.id] : group;
                const hasDeployments = deployments && deployments.length > 0;
                return (
                  <div
                    key={group.id}
                    ref={(el) => { groupRefs.current[group.id] = el; }}
                    className={`bg-gray-100/50 dark:bg-gray-800/50 border rounded p-3 space-y-2 ${focusGroupId === group.id ? 'border-sky-600' : 'border-gray-200 dark:border-gray-800'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full ${group.color}`} />
                      <input
                        value={working.name}
                        onChange={(e) => updateGroupDraft(group.id, { name: e.target.value })}
                        className="flex-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-gray-800 dark:text-gray-200 focus:outline-none focus:border-sky-600"
                        placeholder="Group name"
                      />
                      <button
                        onClick={() => update({ defaultGroupId: draft.defaultGroupId === group.id ? undefined : group.id })}
                        className={`transition-colors ${draft.defaultGroupId === group.id ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-600 hover:text-yellow-400'}`}
                        title={draft.defaultGroupId === group.id ? 'Unset default' : 'Set as default'}
                      >
                        <Star size={12} fill={draft.defaultGroupId === group.id ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={() => removeGroup(group.id)}
                        className="text-gray-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>

                    {/* Selected deployments as tags */}
                    {working.patterns.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {working.patterns.map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 bg-gray-100/80 dark:bg-gray-800/80"
                          >
                            {name}
                            <button
                              onClick={() => updateGroupDraft(group.id, {
                                patterns: working.patterns.filter((p) => p !== name),
                              })}
                              className="text-gray-500 hover:text-red-400"
                            >
                              <X size={8} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Edit members button or checkbox list */}
                    {!isEditing && !hasDraft && (
                      <button
                        onClick={() => startEditingGroup(group.id)}
                        disabled={loadingDeployments}
                        className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors disabled:text-gray-600"
                      >
                        {loadingDeployments ? 'Loading…' : 'Edit members'}
                      </button>
                    )}

                    {isEditing && (
                      <div className="max-h-32 overflow-y-auto bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded p-2 space-y-1">
                        {loadingDeployments && (
                          <p className="text-[10px] text-gray-400 dark:text-gray-600">Loading deployments…</p>
                        )}
                        {!loadingDeployments && !hasDeployments && (
                          <p className="text-[10px] text-gray-600">No deployments available</p>
                        )}
                        {!loadingDeployments && hasDeployments && deployments.map((d) => {
                          const checked = working.patterns.includes(d.name);
                          return (
                            <label key={d.name} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  updateGroupDraft(group.id, {
                                    patterns: checked
                                      ? working.patterns.filter((p) => p !== d.name)
                                      : [...working.patterns, d.name],
                                  });
                                }}
                                className="accent-sky-600 w-3 h-3"
                              />
                              <span className="truncate">{d.name}</span>
                              <span className="text-[10px] text-gray-600 shrink-0">({d.namespace})</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* Per-group Save / Cancel */}
                    {hasDraft && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => saveGroupEdit(group.id)}
                          className="px-2 py-1 text-[10px] bg-sky-700 text-white rounded hover:bg-sky-600 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => cancelGroupEdit(group.id)}
                          className="px-2 py-1 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            className="px-3 py-1.5 text-xs bg-sky-700 text-white rounded hover:bg-sky-600 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
