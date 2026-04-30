import { useCallback, useEffect, useState } from 'react';
import { Layers, RefreshCw, Server } from 'lucide-react';
import type { Context, Deployment, DeploymentStatus } from './types';
import { deploymentStatus } from './types';
import { fetchContexts, fetchDeployments, fetchNamespaces } from './api';
import { DeploymentCard } from './components/DeploymentCard';
import { LogDock, LogTab } from './components/LogDock';

export default function App() {
  const [contexts, setContexts] = useState<Context[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNs, setSelectedNs] = useState('all');
  const [allDeployments, setAllDeployments] = useState<Deployment[]>([]);
  const [pinned, setPinned] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('pinned') || '[]'); } catch { return []; }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DeploymentStatus>('all');
  const [sidebarWidth, setSidebarWidth] = useState(256);
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
      const deps = await fetchDeployments(selectedNs);
      setAllDeployments(deps);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedNs]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { loadDeployments(); }, [loadDeployments]);

  const currentCtx = contexts.find((c) => c.current);
  const filtered = allDeployments.filter((d) => {
    const matchSearch = d.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || deploymentStatus(d) === statusFilter;
    return matchSearch && matchStatus;
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

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2 text-sky-400">
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
          className="bg-gray-900 border border-gray-700 text-xs text-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:border-sky-600"
        >
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>{ns}</option>
          ))}
        </select>
        <button
          onClick={loadDeployments}
          className="text-gray-500 hover:text-gray-200 transition-colors"
          title="Refresh deployments"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar — deployment selector */}
        <aside
          className="shrink-0 border-r border-gray-800 flex flex-col relative"
          style={{ width: `${sidebarWidth}px` }}
        >
          {/* Resize handle */}
          <div
            onMouseDown={onSidebarResizeStart}
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-gray-800 hover:bg-sky-600 transition-colors z-10"
          />
          <div className="px-4 pt-3 pb-2 border-b border-gray-800 flex flex-col gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deployments…"
              className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-sky-600"
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
                      : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {f === 'all' ? `All ${counts.all}` : f === 'Running' ? `▶ ${counts.Running}` : f === 'Degraded' ? `⚠ ${counts.Degraded}` : `■ ${counts.Stopped}`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {error && (
              <p className="text-xs text-red-400 px-4 py-3">{error}</p>
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
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-gray-800 transition-colors ${
                    isPinned ? 'bg-gray-800/60' : ''
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${st === 'Running' ? 'animate-pulse' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 truncate">{dep.name}</p>
                    <p className="text-[10px] text-gray-600">{dep.namespace}</p>
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
          <div className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-600">
            {allDeployments.length} deployment{allDeployments.length !== 1 ? 's' : ''}
            {pinned.length > 0 && ` · ${pinned.length} pinned`}
          </div>
        </aside>

        {/* Main grid */}
        <main className="flex-1 overflow-auto p-5">
          {pinnedDeployments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
              <Layers size={40} className="text-gray-800" />
              <p className="text-sm text-gray-600">Click deployments on the left to pin them here</p>
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
      />
    </div>
  );
}
