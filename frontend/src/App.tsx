import { useCallback, useEffect, useRef, useState } from 'react';
import { Layers, RefreshCw, Server, Settings, Sun, Moon, AlertTriangle } from 'lucide-react';
import { useTheme } from './hooks/useTheme';
import { useEvents } from './hooks/useEvents';
import type { Context, Deployment, DeploymentStatus, K8sEvent } from './types';
import { deploymentStatus } from './types';
import { deletePod, fetchConfigMap, fetchContexts, fetchDeploymentYaml, fetchDeployments, fetchNamespaces, fetchSecret, restartDeployment, updateConfigMap, updateSecret } from './api';
import { DeploymentCard } from './components/DeploymentCard';
import { LogDock, LogTab } from './components/LogDock';
import { ResourceEditorModal } from './components/ResourceEditorModal';
import { SettingsModal, loadSettings, saveSettings } from './components/SettingsModal';
import { YamlViewerModal } from './components/YamlViewerModal';

function getColorHex(twClass: string): string {
  const map: Record<string, string> = {
    'bg-rose-600': '#e11d48',
    'bg-orange-600': '#ea580c',
    'bg-amber-600': '#d97706',
    'bg-emerald-600': '#059669',
    'bg-sky-600': '#0284c7',
    'bg-indigo-600': '#4f46e5',
    'bg-violet-600': '#7c3aed',
    'bg-pink-600': '#db2777',
  };
  return map[twClass] || '#4b5563';
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [contexts, setContexts] = useState<Context[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const loaded = loadSettings();
  const hasDefaultGroup = loaded.defaultGroupId && loaded.groups.find((g) => g.id === loaded.defaultGroupId);
  const [selectedNs, setSelectedNs] = useState(hasDefaultGroup ? 'all' : loaded.defaultNamespace);
  const [allDeployments, setAllDeployments] = useState<Deployment[]>([]);
  const [pinned, setPinned] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('pinned') || '[]'); } catch { return []; }
  });
  const [settings, setSettings] = useState(loaded);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocusGroupId, setSettingsFocusGroupId] = useState<string | null>(null);
  const [fullDeploymentsForSettings, setFullDeploymentsForSettings] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DeploymentStatus>('all');
  const [groupFilter, setGroupFilter] = useState<string | null>(loaded.defaultGroupId || null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKind, setEditorKind] = useState<'configmap' | 'secret' | null>(null);
  const [editorName, setEditorName] = useState('');
  const [editorNs, setEditorNs] = useState('');
  const [editorData, setEditorData] = useState<Record<string, string>>({});
  const [editorLoading, setEditorLoading] = useState(false);
  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlContent, setYamlContent] = useState('');
  const [yamlName, setYamlName] = useState('');
  const [yamlNs, setYamlNs] = useState('');
  const [yamlLoading, setYamlLoading] = useState(false);
  const [logTabs, setLogTabs] = useState<LogTab[]>([]);

  function onSidebarResizeStart(e: React.MouseEvent) {
    const startX = e.clientX;
    const startW = sidebarWidth;

    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      setSidebarWidth(Math.max(180, Math.min(500, startW + delta)));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ctxs, nss] = await Promise.all([fetchContexts(), fetchNamespaces()]);
      setContexts(ctxs);
      setNamespaces(['all', ...nss]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDeployments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const activeGroup = groupFilter ? settings.groups.find((g) => g.id === groupFilter) : null;
      const names = activeGroup ? activeGroup.patterns : undefined;
      const deps = await fetchDeployments(selectedNs, names);
      setAllDeployments(deps);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedNs, groupFilter, settings.groups]);

  const { events, connected, clearEvents } = useEvents(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-refresh deployments when relevant events arrive (debounced 2s)
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    const relevantKinds = ['Deployment', 'Pod', 'ReplicaSet'];
    if (!relevantKinds.includes(latest.involvedObject.kind)) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      loadDeployments();
    }, 2000);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [events, loadDeployments]);

  // Fallback polling every 10s to keep UI up to date even if WS fails
  useEffect(() => {
    const id = setInterval(() => {
      loadDeployments();
    }, 10000);
    return () => clearInterval(id);
  }, [loadDeployments]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { loadDeployments(); }, [loadDeployments]);

  // Switch to 'all' namespaces when a group filter is active (groups may span namespaces)
  useEffect(() => {
    if (groupFilter && selectedNs !== 'all') {
      setSelectedNs('all');
    }
  }, [groupFilter]);

  // Clear group filter if the group no longer exists in settings
  useEffect(() => {
    if (groupFilter && !settings.groups.find((g) => g.id === groupFilter)) {
      setGroupFilter(null);
    }
  }, [settings.groups, groupFilter]);

  const currentCtx = contexts.find((c) => c.current);
  const filtered = allDeployments.filter((d) => {
    const matchSearch = d.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || deploymentStatus(d) === statusFilter;
    const matchGroup =
      !groupFilter ||
      settings.groups
        .find((g) => g.id === groupFilter)
        ?.patterns.includes(d.name) ||
      false;
    return matchSearch && matchStatus && matchGroup;
  });
  const pinnedDeployments = pinned
    .map((key) => allDeployments.find((d) => `${d.namespace}/${d.name}` === key))
    .filter(Boolean) as Deployment[];

  const counts = {
    all: allDeployments.length,
    Running: allDeployments.filter((d) => deploymentStatus(d) === 'Running').length,
    Degraded: allDeployments.filter((d) => deploymentStatus(d) === 'Degraded').length,
    Stopped: allDeployments.filter((d) => deploymentStatus(d) === 'Stopped').length,
  };

  function openLogTab(podName: string, namespace: string, container: string, deploymentName: string) {
    const id = `${namespace}/${podName}/${container}`;
    setLogTabs((prev) => {
      if (prev.find((t) => t.id === id)) return prev;
      return [...prev, { id, podName, namespace, container, deploymentName }];
    });
  }

  function closeLogTab(id: string) {
    setLogTabs((prev) => prev.filter((t) => t.id !== id));
  }

  async function openResource(kind: 'configmap' | 'secret', namespace: string, name: string) {
    setEditorKind(kind);
    setEditorName(name);
    setEditorNs(namespace);
    setEditorData({});
    setEditorOpen(true);
    setEditorLoading(true);
    try {
      if (kind === 'configmap') {
        const cm = await fetchConfigMap(namespace, name);
        setEditorData(cm.data || {});
      } else {
        const s = await fetchSecret(namespace, name);
        setEditorData(s.data || {});
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setEditorLoading(false);
    }
  }

  async function handleRestart(dep: Deployment) {
    setLoading(true);
    try {
      await restartDeployment(dep.name, dep.namespace);
      await new Promise((r) => setTimeout(r, 500));
      await loadDeployments();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleRestartPod(podName: string, namespace: string) {
    setLoading(true);
    try {
      await deletePod(podName, namespace);
      await new Promise((r) => setTimeout(r, 500));
      await loadDeployments();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function openYaml(dep: Deployment) {
    setYamlOpen(true);
    setYamlName(dep.name);
    setYamlNs(dep.namespace);
    setYamlContent('');
    setYamlLoading(true);
    try {
      const yaml = await fetchDeploymentYaml(dep.name, dep.namespace);
      setYamlContent(yaml);
    } catch (e) {
      setError(String(e));
    } finally {
      setYamlLoading(false);
    }
  }

  async function saveResource(data: Record<string, string>) {
    if (!editorKind || !editorName || !editorNs) return;
    setEditorLoading(true);
    try {
      if (editorKind === 'configmap') {
        await updateConfigMap(editorNs, editorName, data);
      } else {
        await updateSecret(editorNs, editorName, data);
      }
      setEditorOpen(false);
      setEditorKind(null);
      setEditorName('');
      setEditorNs('');
      setEditorData({});
    } catch (e) {
      setError(String(e));
    } finally {
      setEditorLoading(false);
    }
  }

  function togglePin(dep: Deployment) {
    const key = `${dep.namespace}/${dep.name}`;
    setPinned((prev) => {
      const idx = prev.indexOf(key);
      if (idx >= 0) {
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      }
      return [...prev, key];
    });
  }

  useEffect(() => {
    localStorage.setItem('pinned', JSON.stringify(pinned));
  }, [pinned]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-gray-950">
      {/* Top bar */}
      <header className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2 text-sky-500 dark:text-sky-400">
          <Layers size={20} />
          <span className="font-bold text-sm tracking-wider">K3S INSPECTOR</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 ml-2">
          <Server size={12} />
          <span>{currentCtx ? currentCtx.name : '—'}</span>
        </div>
        <div className="flex-1" />
        <select
          value={selectedNs}
          onChange={(e) => setSelectedNs(e.target.value)}
          className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:border-sky-600"
        >
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>{ns}</option>
          ))}
        </select>
        <button
          onClick={toggleTheme}
          className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          onClick={loadDeployments}
          className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          title="Refresh deployments"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => {
            setSettingsFocusGroupId(null);
            setSettingsOpen(true);
          }}
          className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          title="Settings"
        >
          <Settings size={15} />
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar — deployment selector */}
        <aside
          className="shrink-0 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 flex flex-col relative"
          style={{ width: `${sidebarWidth}px` }}
        >
          {/* Resize handle */}
          <div
            onMouseDown={onSidebarResizeStart}
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-gray-800 hover:bg-sky-600 transition-colors z-10"
          />
          <div className="px-4 pt-3 pb-2 border-b border-gray-200 dark:border-gray-800 flex flex-col gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deployments…"
              className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-sky-600"
            />
            <div className="flex gap-1">
              {(['all', 'Running', 'Degraded', 'Stopped'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`flex-1 text-[10px] py-1 rounded transition-colors ${
                    statusFilter === f
                      ? f === 'all'
                        ? 'bg-sky-700 text-white'
                        : f === 'Running'
                        ? 'bg-emerald-700 text-white'
                        : f === 'Degraded'
                        ? 'bg-yellow-700 text-white'
                        : 'bg-gray-700 text-white'
                      : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'
                  }`}
                >
                  {f === 'all' ? `All ${counts.all}` : f === 'Running' ? `▶ ${counts.Running}` : f === 'Degraded' ? `⚠ ${counts.Degraded}` : `■ ${counts.Stopped}`}
                </button>
              ))}
            </div>
            {settings.groups.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setGroupFilter(null)}
                  className={`text-[10px] px-2 py-1 rounded transition-colors ${
                    groupFilter === null
                      ? 'bg-sky-700 text-white'
                      : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'
                  }`}
                >
                  All groups
                </button>
                {settings.groups.map((g) => {
                  const active = groupFilter === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => setGroupFilter(active ? null : g.id)}
                      className={`text-[10px] px-2 py-1 rounded transition-colors flex items-center gap-1 ${
                        active ? 'text-white' : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                      }`}
                      style={active ? { backgroundColor: getColorHex(g.color) } : undefined}
                      title={g.patterns.length ? g.patterns.join(', ') : 'Empty group'}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${g.color}`} />
                      {g.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {error && (
              <div className="mx-3 mt-3 mb-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle size={13} className="text-red-500 shrink-0" />
                  <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">Something went wrong</span>
                </div>
                <p className="text-[10px] text-red-500 dark:text-red-400 leading-relaxed">{error}</p>
                <button
                  onClick={() => setError('')}
                  className="self-start text-[10px] text-red-600 dark:text-red-400 hover:underline mt-0.5"
                >
                  Dismiss
                </button>
              </div>
            )}
            {filtered.length === 0 && !loading && !error && (
              <p className="text-xs text-gray-600 px-4 py-4">No deployments found</p>
            )}
            {filtered.map((dep) => {
              const key = `${dep.namespace}/${dep.name}`;
              const isPinned = pinned.includes(key);
              const st = deploymentStatus(dep);
              const dotColor =
                st === 'Running' ? 'bg-emerald-400' :
                st === 'Degraded' ? 'bg-yellow-400' : 'bg-gray-600';
              return (
                <button
                  key={key}
                  onClick={() => togglePin(dep)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                    isPinned ? 'bg-gray-100/60 dark:bg-gray-800/60' : ''
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${st === 'Running' ? 'animate-pulse' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-800 dark:text-gray-200 truncate">{dep.name}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-600">{dep.namespace}</p>
                  </div>
                  <span className={`text-[10px] shrink-0 ${
                    st === 'Running' ? 'text-emerald-600' :
                    st === 'Degraded' ? 'text-yellow-600' : 'text-gray-700'
                  }`}>
                    {dep.replicas.ready}/{dep.replicas.desired}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Events panel */}
          {events.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-800">
              <div className="px-3 py-1.5 flex items-center justify-between border-b border-gray-200 dark:border-gray-800/50">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500'}`} />
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Events</span>
                </div>
                <button
                  onClick={clearEvents}
                  className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  title="Clear events"
                >
                  Clear
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {events.slice(0, 5).map((ev, i) => (
                  <div
                    key={`${ev.timestamp}-${i}`}
                    className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800/50 last:border-0"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`w-1 h-1 rounded-full ${ev.type === 'Warning' ? 'bg-yellow-400' : 'bg-emerald-400'}`} />
                      <span className="text-[10px] text-gray-700 dark:text-gray-300 font-medium truncate">{ev.reason}</span>
                      <span className="text-[9px] text-gray-400 shrink-0">{ev.involvedObject.kind}/{ev.involvedObject.name}</span>
                    </div>
                    <p className="text-[9px] text-gray-500 dark:text-gray-500 leading-tight truncate" title={ev.message}>
                      {ev.message}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-800 text-[10px] text-gray-500 dark:text-gray-600">
            {allDeployments.length} deployment{allDeployments.length !== 1 ? 's' : ''}
            {pinned.length > 0 && ` · ${pinned.length} pinned`}
          </div>
        </aside>

        {/* Main grid */}
        <main className="flex-1 overflow-auto p-5">
          {pinnedDeployments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
              <Layers size={40} className="text-gray-300 dark:text-gray-800" />
              <p className="text-sm text-gray-500 dark:text-gray-600">Click deployments on the left to pin them here</p>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 items-start">
              {pinnedDeployments.map((dep) => {
                const key = `${dep.namespace}/${dep.name}`;
                return (
                  <DeploymentCard
                    key={key}
                    deployment={dep}
                    onRemove={() => togglePin(dep)}
                    onRefresh={loadDeployments}
                    onOpenLog={openLogTab}
                    onOpenResource={openResource}
                    autoExpandPods={settings.autoExpandPods}
                    onRestart={() => handleRestart(dep)}
                    onViewYaml={() => openYaml(dep)}
                    onRestartPod={handleRestartPod}
                  />
                );
              })}
            </div>
          )}
        </main>
      </div>
      <LogDock
        tabs={logTabs}
        onClose={closeLogTab}
        onCloseAll={() => setLogTabs([])}
        tail={settings.logTailLines}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setFullDeploymentsForSettings([]);
          setSettingsFocusGroupId(null);
        }}
        settings={settings}
        onChange={setSettings}
        namespaces={namespaces}
        deployments={fullDeploymentsForSettings.length ? fullDeploymentsForSettings.map((d) => ({ name: d.name, namespace: d.namespace })) : undefined}
        onRequestDeployments={async () => {
          const full = await fetchDeployments('all');
          setFullDeploymentsForSettings(full);
        }}
        focusGroupId={settingsFocusGroupId}
      />
      <ResourceEditorModal
        open={editorOpen}
        kind={editorKind}
        namespace={editorNs}
        name={editorName}
        data={editorData}
        loading={editorLoading}
        onClose={() => {
          setEditorOpen(false);
          setEditorKind(null);
          setEditorName('');
          setEditorNs('');
          setEditorData({});
        }}
        onSave={saveResource}
      />
      <YamlViewerModal
        open={yamlOpen}
        name={yamlName}
        namespace={yamlNs}
        yaml={yamlContent}
        loading={yamlLoading}
        onClose={() => {
          setYamlOpen(false);
          setYamlContent('');
          setYamlName('');
          setYamlNs('');
        }}
      />
    </div>
  );
}
