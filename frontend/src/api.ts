import type { ConfigMap, Context, Deployment, Ingress, Pod, Secret } from './types';

const BASE = '/api';

export async function fetchContexts(): Promise<Context[]> {
  const r = await fetch(`${BASE}/contexts`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchNamespaces(): Promise<string[]> {
  const r = await fetch(`${BASE}/namespaces`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchDeployments(namespace: string, names?: string[]): Promise<Deployment[]> {
  const params = new URLSearchParams({ namespace });
  if (names?.length) params.set('names', names.join(','));
  const r = await fetch(`${BASE}/deployments?${params}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchDeployment(name: string, namespace: string): Promise<Deployment> {
  const r = await fetch(`${BASE}/deployments/${name}?namespace=${namespace}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function scaleDeployment(
  name: string,
  namespace: string,
  replicas: number
): Promise<void> {
  const r = await fetch(`${BASE}/deployments/${name}/scale?namespace=${namespace}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ replicas }),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function restartDeployment(name: string, namespace: string): Promise<void> {
  const r = await fetch(`${BASE}/deployments/${namespace}/${name}/restart`, {
    method: 'POST',
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function fetchPods(name: string, namespace: string): Promise<Pod[]> {
  const r = await fetch(`${BASE}/deployments/${name}/pods?namespace=${namespace}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchIngress(name: string, namespace: string): Promise<Ingress[]> {
  const r = await fetch(`${BASE}/deployments/${name}/ingress?namespace=${namespace}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchConfigMaps(namespace: string): Promise<ConfigMap[]> {
  const r = await fetch(`${BASE}/configmaps?namespace=${namespace}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchSecrets(namespace: string): Promise<Secret[]> {
  const r = await fetch(`${BASE}/secrets?namespace=${namespace}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchConfigMap(namespace: string, name: string): Promise<ConfigMap & { data: Record<string, string> }> {
  const r = await fetch(`${BASE}/configmaps/${namespace}/${name}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateConfigMap(namespace: string, name: string, data: Record<string, string>): Promise<void> {
  const r = await fetch(`${BASE}/configmaps/${namespace}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function fetchSecret(namespace: string, name: string): Promise<Secret & { data: Record<string, string> }> {
  const r = await fetch(`${BASE}/secrets/${namespace}/${name}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateSecret(namespace: string, name: string, data: Record<string, string>): Promise<void> {
  const r = await fetch(`${BASE}/secrets/${namespace}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!r.ok) throw new Error(await r.text());
}

export function openLogStream(
  pod: string,
  namespace: string,
  container: string,
  onLine: (line: string) => void,
  onClose: () => void,
  tail = 200
): WebSocket {
  const url = `/ws/logs?namespace=${namespace}&pod=${pod}&container=${container}&tail=${tail}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}${url}`);
  ws.onmessage = (e) => {
    const lines = (e.data as string).split('\n').filter(Boolean);
    lines.forEach(onLine);
  };
  ws.onclose = onClose;
  return ws;
}
