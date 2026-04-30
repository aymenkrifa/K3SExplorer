export interface Context {
  name: string;
  cluster: string;
  current: boolean;
}

export interface Replicas {
  desired: number;
  ready: number;
  available: number;
  updated: number;
}

export interface Condition {
  type: string;
  status: string;
  reason: string;
  message: string;
}

export type DeploymentStatus = 'Running' | 'Degraded' | 'Stopped';

export interface Deployment {
  name: string;
  namespace: string;
  createdAt: string | null;
  replicas: Replicas;
  conditions: Condition[];
  availableStatus: string;
  images: string[];
  labels: Record<string, string>;
}

export interface Pod {
  name: string;
  phase: string;
  createdAt: string | null;
  ready: boolean;
  restarts: number;
  containers: string[];
}

export interface IngressRule {
  host: string;
  paths: { path: string; service: string }[];
}

export interface Ingress {
  name: string;
  rules: IngressRule[];
}

export function deploymentStatus(d: Deployment): DeploymentStatus {
  if (d.replicas.desired === 0) return 'Stopped';
  if (d.replicas.ready === d.replicas.desired) return 'Running';
  return 'Degraded';
}
