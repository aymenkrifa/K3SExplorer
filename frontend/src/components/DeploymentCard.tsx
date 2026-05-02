import { useEffect, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  Container,
  FileCode,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Zap,
  ScrollText,
  X,
} from 'lucide-react';
import type { Deployment, DeploymentStatus, Ingress, Pod } from '../types';
import { deploymentStatus } from '../types';
import { fetchPodMetrics, scaleDeployment } from '../api';

interface Props {
  deployment: Deployment;
  onRemove: () => void;
  onRefresh: () => void;
  onOpenLog: (podName: string, namespace: string, container: string, deploymentName: string) => void;
  onOpenResource?: (kind: 'configmap' | 'secret', namespace: string, name: string) => void;
  autoExpandPods?: boolean;
  onRestart?: () => void;
  onViewYaml?: () => void;
  onRestartPod?: (podName: string, namespace: string) => void;
}

function age(createdAt: string | null): string {
  if (!createdAt) return '-';
  const diff = Date.now() - new Date(createdAt).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function parseCpu(val: string): number {
  if (val.endsWith('n')) return parseInt(val, 10) / 1e9;
  if (val.endsWith('u')) return parseInt(val, 10) / 1e6;
  if (val.endsWith('m')) return parseInt(val, 10) / 1000;
  return parseFloat(val);
}

function formatCpu(cores: number): string {
  if (cores < 0.01) return `${(cores * 1000).toFixed(0)}m`;
  return `${cores.toFixed(2)}`;
}

function parseMemory(val: string): number {
  if (val.endsWith('Ki')) return parseInt(val, 10) * 1024;
  if (val.endsWith('Mi')) return parseInt(val, 10) * 1024 * 1024;
  if (val.endsWith('Gi')) return parseInt(val, 10) * 1024 * 1024 * 1024;
  if (val.endsWith('Ti')) return parseInt(val, 10) * 1024 * 1024 * 1024 * 1024;
  if (val.endsWith('k')) return parseInt(val, 10) * 1000;
  if (val.endsWith('M')) return parseInt(val, 10) * 1000 * 1000;
  if (val.endsWith('G')) return parseInt(val, 10) * 1000 * 1000 * 1000;
  return parseInt(val, 10);
}

function formatMemory(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}Gi`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}Mi`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}Ki`;
  return `${bytes}B`;
}

export function DeploymentCard({ deployment: initial, onRemove, onRefresh, onOpenLog, onOpenResource, autoExpandPods = true, onRestart, onViewYaml, onRestartPod }: Props) {
  const [dep, setDep] = useState<Deployment>(initial);
  const pods = dep.pods || [];
  const ingresses = dep.ingresses || [];
  const [podsExpanded, setPodsExpanded] = useState(autoExpandPods);
  const [ingressExpanded, setIngressExpanded] = useState(false);
  const [configMapsExpanded, setConfigMapsExpanded] = useState(false);
  const [secretsExpanded, setSecretsExpanded] = useState(false);
  const [scaling, setScaling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [podMetrics, setPodMetrics] = useState<Record<string, { cpu: string; memory: string }>>({});

  useEffect(() => {
    setDep(initial);
  }, [initial]);

  // Fetch metrics for visible pods
  useEffect(() => {
    if (!podsExpanded) return;
    const abort = new AbortController();
    async function load() {
      const next: Record<string, { cpu: string; memory: string }> = {};
      for (const pod of pods) {
        if (abort.signal.aborted) return;
        try {
          const m = await fetchPodMetrics(pod.name, dep.namespace);
          const totalCpu = m.containers.reduce((sum, c) => sum + parseCpu(c.cpu), 0);
          const totalMem = m.containers.reduce((sum, c) => sum + parseMemory(c.memory), 0);
          next[pod.name] = { cpu: formatCpu(totalCpu), memory: formatMemory(totalMem) };
        } catch { /* metrics-server may not be installed */ }
      }
      if (!abort.signal.aborted) setPodMetrics(next);
    }
    load();
    return () => abort.abort();
  }, [podsExpanded, pods, dep.namespace]);

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  function toggleAll(expand: boolean) {
    setIngressExpanded(expand);
    setConfigMapsExpanded(expand);
    setSecretsExpanded(expand);
    setPodsExpanded(expand);
  }

  async function scale(delta: number) {
    const next = Math.max(0, dep.replicas.desired + delta);
    setScaling(true);
    try {
      await scaleDeployment(dep.name, dep.namespace, next);
      await new Promise((r) => setTimeout(r, 500));
      await refresh();
    } finally {
      setScaling(false);
    }
  }

  const status: DeploymentStatus = deploymentStatus(dep);
  const ready = dep.replicas.ready;
  const desired = dep.replicas.desired;

  const statusDot: Record<DeploymentStatus, string> = {
    Running: 'bg-emerald-400',
    Degraded: 'bg-yellow-400',
    Stopped: 'bg-gray-600',
  };
  const statusText: Record<DeploymentStatus, string> = {
    Running: 'text-emerald-400',
    Degraded: 'text-yellow-400',
    Stopped: 'text-gray-500',
  };
  const statusLabel: Record<DeploymentStatus, string> = {
    Running: 'Running',
    Degraded: 'Degraded',
    Stopped: 'Stopped',
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden flex flex-col shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot[status]} ${status === 'Running' ? 'animate-pulse' : ''}`}
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{dep.name}</p>
          <p className="text-xs text-gray-500">{dep.namespace}</p>
        </div>
        <button
          onClick={() => toggleAll(true)}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-600 dark:hover:text-gray-300 transition-colors text-[10px] leading-none"
          title="Expand all"
        >
          Expand
        </button>
        <button
          onClick={() => toggleAll(false)}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-600 dark:hover:text-gray-300 transition-colors text-[10px] leading-none"
          title="Collapse all"
        >
          Collapse
        </button>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} className={`${refreshing ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={onRemove}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Unpin"
        >
          <X size={14} />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x divide-gray-200 dark:divide-gray-800 text-center">
        <div className="py-3 flex flex-col items-center gap-1">
          <Activity size={13} className="text-gray-500" />
          <p className={`text-xs font-semibold ${statusText[status]}`}>
            {statusLabel[status]}
          </p>
        </div>
        <div className="py-3 flex flex-col items-center gap-1">
          <Container size={13} className="text-gray-500" />
          <p className="text-[10px] text-gray-500">
            <span className={ready < desired && desired > 0 ? 'text-yellow-400' : 'text-gray-900 dark:text-gray-100'}>
              {ready}
            </span>
            <span className="text-gray-400">/{desired}</span>
          </p>
          {(dep.replicas.available !== ready || dep.replicas.updated !== ready) && (
            <p className="text-[10px] text-gray-400">
              av:{dep.replicas.available} up:{dep.replicas.updated}
            </p>
          )}
        </div>
        <div className="py-3 flex flex-col items-center gap-1">
          <Clock size={13} className="text-gray-500" />
          <p className="text-xs text-gray-600 dark:text-gray-300">{age(dep.createdAt)}</p>
        </div>
      </div>

      {/* Deployment conditions */}
      {dep.conditions.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-1 border-t border-gray-200 dark:border-gray-800 flex-wrap">
          {dep.conditions
            .filter((c) => c.status !== 'True' || (c.type !== 'Available' && c.type !== 'Progressing'))
            .map((c) => {
              const isError = c.status !== 'True' && c.type === 'ReplicaFailure';
              const isProgressing = c.type === 'Progressing' && c.status === 'True';
              const isWarning = c.status !== 'True';
              return (
                <span
                  key={c.type}
                  className={`text-[9px] px-1.5 py-0.5 rounded border ${
                    isError
                      ? 'border-red-400 text-red-400 bg-red-400/10'
                      : isProgressing
                      ? 'border-blue-400 text-blue-400 bg-blue-400/10'
                      : isWarning
                      ? 'border-yellow-400 text-yellow-400 bg-yellow-400/10'
                      : 'border-emerald-400 text-emerald-400 bg-emerald-400/10'
                  }`}
                  title={c.message}
                >
                  {c.reason || c.type}
                </span>
              );
            })}
        </div>
      )}

      {/* Scale controls */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-800">
        <span className="text-xs text-gray-500">Replicas</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => scale(-1)}
            disabled={scaling || dep.replicas.desired === 0}
            className="rounded p-1 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            <Minus size={12} />
          </button>
          <span className="text-sm w-5 text-center">{dep.replicas.desired}</span>
          <button
            onClick={() => scale(1)}
            disabled={scaling}
            className="rounded p-1 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Actions row */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-gray-200 dark:border-gray-800">
        <button
          onClick={onViewYaml}
          disabled={!onViewYaml}
          className="flex items-center gap-1 text-[10px] text-sky-500 hover:text-sky-600 dark:hover:text-sky-400 transition-colors disabled:opacity-30"
          title="View deployment YAML"
        >
          <FileCode size={11} />
          View Deployment
        </button>
        <button
          onClick={onRestart}
          disabled={!onRestart}
          className="flex items-center gap-1 text-[10px] text-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors disabled:opacity-30"
          title="Restart deployment"
        >
          <Zap size={11} />
          Restart
        </button>
      </div>

      <button
        onClick={() => setIngressExpanded((v) => !v)}
        className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span>Ingresses</span>
        {ingressExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {/* Ingress list */}
      {ingressExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-800 divide-y divide-gray-200/50 dark:divide-gray-800/50">
          {ingresses.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-600 px-4 py-3">No ingresses found</p>
          ) : (
            ingresses.map((ing) => {
              const host = ing.rules[0]?.host;
              const baseUrl = host ? `http://${host}/` : '';
              const docsUrl = host ? `http://${host}/docs` : '';
              return (
                <div key={ing.name} className="px-3 py-2 flex items-center justify-between text-[10px]">
                  {baseUrl ? (
                    <a
                      href={baseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:text-sky-300 truncate transition-colors"
                      title={baseUrl}
                    >
                      {host}
                    </a>
                  ) : (
                    <span className="text-gray-500">{ing.name}</span>
                  )}
                  {docsUrl && (
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <a
                        href={docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 transition-colors"
                        title={docsUrl}
                      >
                        Docs
                      </a>
                      <a
                        href={`http://${host}/redoc`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-400 hover:text-orange-300 transition-colors"
                        title={`http://${host}/redoc`}
                      >
                        ReDoc
                      </a>
                      <a
                        href={`http://${host}/openapi.json`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-400 hover:text-purple-300 transition-colors"
                        title={`http://${host}/openapi.json`}
                      >
                        OpenAPI
                      </a>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ConfigMaps */}
      <button
        onClick={() => setConfigMapsExpanded((v) => !v)}
        className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span>ConfigMaps</span>
        {configMapsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {configMapsExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-800 divide-y divide-gray-200/50 dark:divide-gray-800/50">
          {dep.configMaps.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-600 px-4 py-3">No ConfigMaps</p>
          ) : (
            dep.configMaps.map((name) => (
              <button
                key={name}
                onClick={() => onOpenResource?.('configmap', dep.namespace, name)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-left hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-sky-400" />
                <span className="text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0 text-xs">{name}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Secrets */}
      <button
        onClick={() => setSecretsExpanded((v) => !v)}
        className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span>Secrets</span>
        {secretsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {secretsExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-800 divide-y divide-gray-200/50 dark:divide-gray-800/50">
          {dep.secrets.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-600 px-4 py-3">No Secrets</p>
          ) : (
            dep.secrets.map((name) => (
              <button
                key={name}
                onClick={() => onOpenResource?.('secret', dep.namespace, name)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-left hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-orange-400" />
                <span className="text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0 text-xs">{name}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Pods — always at bottom */}
      <button
        onClick={() => setPodsExpanded((v) => !v)}
        className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span>Pods</span>
        {podsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {podsExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-800 divide-y divide-gray-200/50 dark:divide-gray-800/50">
          {pods.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-600 px-4 py-3">No pods found</p>
          ) : (
            pods.map((pod) => {
              const podRunning = pod.phase === 'Running' && pod.ready;
              const podNotReady = pod.phase === 'Running' && !pod.ready;
              const podPending = pod.phase === 'Pending';
              const podSucceeded = pod.phase === 'Succeeded';
              const podFailed = pod.phase === 'Failed';
              const podUnknown = pod.phase === 'Unknown';

              // Badge text and color logic
              let badgeText: string;
              let badgeColor: string;
              let dotColor: string;

              if (pod.terminating) {
                badgeText = 'Terminating';
                badgeColor = 'text-slate-500';
                dotColor = 'bg-slate-400';
              } else if (pod.waitingReason) {
                badgeText = pod.waitingReason;
                badgeColor = pod.waitingReason === 'ContainerCreating' ? 'text-blue-500' : 'text-red-500';
                dotColor = pod.waitingReason === 'ContainerCreating' ? 'bg-blue-400 animate-pulse' : 'bg-red-500';
              } else if (pod.terminatedReason) {
                badgeText = pod.terminatedReason;
                badgeColor = pod.terminatedReason === 'Completed' ? 'text-emerald-500' : 'text-red-500';
                dotColor = pod.terminatedReason === 'Completed' ? 'bg-emerald-400' : 'bg-red-500';
              } else if (podPending) {
                badgeText = 'Pending';
                badgeColor = 'text-yellow-500';
                dotColor = 'bg-yellow-400 animate-pulse';
              } else if (podSucceeded) {
                badgeText = 'Completed';
                badgeColor = 'text-emerald-500';
                dotColor = 'bg-emerald-400';
              } else if (podFailed) {
                badgeText = 'Failed';
                badgeColor = 'text-red-500';
                dotColor = 'bg-red-500';
              } else if (podUnknown) {
                badgeText = 'Unknown';
                badgeColor = 'text-gray-500';
                dotColor = 'bg-gray-400';
              } else if (podNotReady) {
                badgeText = 'Not Ready';
                badgeColor = 'text-yellow-500';
                dotColor = 'bg-yellow-400 animate-pulse';
              } else if (podRunning) {
                badgeText = 'Running';
                badgeColor = 'text-emerald-500';
                dotColor = 'bg-emerald-400 animate-pulse';
              } else {
                badgeText = pod.phase;
                badgeColor = 'text-gray-500';
                dotColor = 'bg-gray-400';
              }

              return (
                <div key={pod.name} className="px-3 py-2 flex flex-col gap-1 text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                    <span className="text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0 text-xs">{pod.name}</span>
                    <button
                      onClick={() => onOpenLog(pod.name, dep.namespace, pod.containers[0] ?? '', dep.name)}
                      title="Open logs in dock"
                      className="text-gray-400 hover:text-sky-500 dark:text-gray-600 dark:hover:text-sky-400 transition-colors shrink-0"
                    >
                      <ScrollText size={12} />
                    </button>
                    <button
                      onClick={() => onRestartPod?.(pod.name, dep.namespace)}
                      disabled={!onRestartPod}
                      title="Restart pod (delete & recreate)"
                      className="text-gray-400 hover:text-orange-500 dark:text-gray-600 dark:hover:text-orange-400 transition-colors shrink-0 disabled:opacity-30"
                    >
                      <RotateCcw size={11} />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 pl-3.5 text-gray-500 dark:text-gray-600">
                    <span className={badgeColor}>{badgeText}</span>
                    <span className="flex items-center gap-1">
                      <Clock size={9} />
                      {age(pod.createdAt)}
                    </span>
                    {pod.restarts > 0 && (
                      <span className="text-orange-400">↺ {pod.restarts} restart{pod.restarts !== 1 ? 's' : ''}</span>
                    )}
                    {podMetrics[pod.name] && (
                      <span className="text-sky-500">
                        ⚡ {podMetrics[pod.name].cpu} · {podMetrics[pod.name].memory}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Images — under pods */}
      <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-2">
        {dep.images.map((img) => (
          <p key={img} className="text-[10px] text-gray-400 dark:text-gray-600 truncate" title={img}>
            Image: {img}
          </p>
        ))}
      </div>

    </div>
  );
}
