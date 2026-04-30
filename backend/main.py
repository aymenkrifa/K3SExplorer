import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from kubernetes import client, config, watch
from kubernetes.client.rest import ApiException
from starlette.websockets import WebSocketState

# ── load kubeconfig ───────────────────────────────────────────────────────────
config.load_kube_config()

v1 = client.CoreV1Api()
apps_v1 = client.AppsV1Api()
networking_v1 = client.NetworkingV1Api()


# ── helpers ─────────────────────────────────────────────────────────────────
def parse_age(created_at: str | None) -> str:
    if not created_at:
        return "-"
    dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    diff = datetime.now(timezone.utc) - dt
    minutes = int(diff.total_seconds() // 60)
    if minutes < 60:
        return f"{minutes}m"
    hours = minutes // 60
    if hours < 24:
        return f"{hours}h"
    return f"{hours // 24}d"


def map_deployment(d):
    conds = d.status.conditions or []
    available = next((c for c in conds if c.type == "Available"), None)
    return {
        "name": d.metadata.name or "",
        "namespace": d.metadata.namespace or "",
        "createdAt": d.metadata.creation_timestamp.isoformat()
        if d.metadata.creation_timestamp
        else None,
        "replicas": {
            "desired": d.spec.replicas or 0,
            "ready": d.status.ready_replicas or 0,
            "available": d.status.available_replicas or 0,
            "updated": d.status.updated_replicas or 0,
        },
        "conditions": [
            {
                "type": c.type,
                "status": c.status,
                "reason": c.reason or "",
                "message": c.message or "",
            }
            for c in conds
        ],
        "availableStatus": "True"
        if available and available.status == "True"
        else "False",
        "images": [c.image or "" for c in (d.spec.template.spec.containers or [])],
        "labels": dict(d.metadata.labels or {}),
    }


def map_pods(namespace, selector):
    label_selector = ",".join(f"{k}={v}" for k, v in selector.items())
    pod_list = v1.list_namespaced_pod(
        namespace=namespace,
        label_selector=label_selector,
    )
    pods = []
    for p in pod_list.items:
        cs = p.status.container_statuses or []
        pods.append(
            {
                "name": p.metadata.name or "",
                "phase": p.status.phase or "Unknown",
                "createdAt": p.metadata.creation_timestamp.isoformat()
                if p.metadata.creation_timestamp
                else None,
                "ready": all(c.ready for c in cs),
                "restarts": sum(c.restart_count for c in cs),
                "containers": [c.name for c in (p.spec.containers or [])],
            }
        )
    return pods


def map_ingresses(namespace, dep_labels):
    svc_list = v1.list_namespaced_service(namespace)
    matching_services = set()
    for svc in svc_list.items:
        selector = dict(svc.spec.selector or {})
        if selector and all(dep_labels.get(k) == v for k, v in selector.items()):
            matching_services.add(svc.metadata.name)

    ingress_list = networking_v1.list_namespaced_ingress(namespace)
    result = []
    for ing in ingress_list.items:
        ing_services = set()
        for rule in (ing.spec.rules or []):
            for p in (rule.http.paths if rule.http else []):
                svc = p.backend.service.name if p.backend and p.backend.service else ""
                if svc:
                    ing_services.add(svc)

        if ing_services & matching_services:
            rules = []
            for rule in (ing.spec.rules or []):
                host = rule.host or "*"
                paths = []
                for p in (rule.http.paths if rule.http else []):
                    service_name = p.backend.service.name if p.backend and p.backend.service else ""
                    paths.append({"path": p.path or "/", "service": service_name})
                if paths:
                    rules.append({"host": host, "paths": paths})
            if rules:
                result.append({"name": ing.metadata.name or "", "rules": rules})
    return result


# ── app ──────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# GET /api/contexts
@app.get("/api/contexts")
async def get_contexts():
    contexts, active = config.list_kube_config_contexts()
    current = active["name"] if active else None
    return [
        {
            "name": ctx["name"],
            "cluster": ctx.get("context", {}).get("cluster"),
            "current": ctx["name"] == current,
        }
        for ctx in contexts
    ]


# GET /api/namespaces
@app.get("/api/namespaces")
async def get_namespaces():
    try:
        ns_list = v1.list_namespace()
        return [ns.metadata.name for ns in ns_list.items if ns.metadata.name]
    except ApiException as e:
        return {"error": str(e)}


# GET /api/deployments
@app.get("/api/deployments")
async def list_deployments(namespace: str = "default", names: str = ""):
    try:
        name_set = set(names.split(",")) if names else set()
        if namespace == "all":
            deps = apps_v1.list_deployment_for_all_namespaces()
        else:
            deps = apps_v1.list_namespaced_deployment(namespace)
        result = []
        for d in deps.items:
            dep_name = d.metadata.name or ""
            if name_set and dep_name not in name_set:
                continue
            dep = map_deployment(d)
            dep["pods"] = map_pods(dep["namespace"], d.spec.selector.match_labels or {})
            dep["ingresses"] = map_ingresses(dep["namespace"], d.spec.selector.match_labels or {})
            result.append(dep)
        return result
    except ApiException as e:
        return {"error": str(e)}


# GET /api/deployments/{name}
@app.get("/api/deployments/{name}")
async def get_deployment(name: str, namespace: str = "default"):
    try:
        dep = apps_v1.read_namespaced_deployment(name, namespace)
        return map_deployment(dep)
    except ApiException as e:
        return {"error": str(e)}


# PATCH /api/deployments/{name}/scale
@app.patch("/api/deployments/{name}/scale")
async def scale_deployment(name: str, namespace: str = "default", body: dict = {}):
    replicas = body.get("replicas", 0)
    try:
        patch = {"spec": {"replicas": replicas}}
        apps_v1.patch_namespaced_deployment(
            name=name,
            namespace=namespace,
            body=patch,
            field_manager="k3s-inspector",
        )
        return {"ok": True, "replicas": replicas}
    except ApiException as e:
        return {"error": str(e)}


# GET /api/deployments/{name}/pods
@app.get("/api/deployments/{name}/pods")
async def get_pods(name: str, namespace: str = "default"):
    try:
        dep = apps_v1.read_namespaced_deployment(name, namespace)
        selector = dep.spec.selector.match_labels or {}
        label_selector = ",".join(f"{k}={v}" for k, v in selector.items())
        pod_list = v1.list_namespaced_pod(
            namespace=namespace,
            label_selector=label_selector,
        )
        pods = []
        for p in pod_list.items:
            cs = p.status.container_statuses or []
            pods.append(
                {
                    "name": p.metadata.name or "",
                    "phase": p.status.phase or "Unknown",
                    "createdAt": p.metadata.creation_timestamp.isoformat()
                    if p.metadata.creation_timestamp
                    else None,
                    "ready": all(c.ready for c in cs),
                    "restarts": sum(c.restart_count for c in cs),
                    "containers": [c.name for c in (p.spec.containers or [])],
                }
            )
        return pods
    except ApiException as e:
        return {"error": str(e)}


# WS /ws/logs
@app.websocket("/ws/logs")
async def log_stream(ws: WebSocket):
    await ws.accept()
    params = dict(ws.query_params)
    ns = params.get("namespace", "default")
    pod = params.get("pod", "")
    container = params.get("container", "")
    tail = int(params.get("tail", "200"))

    if not pod:
        await ws.close(code=1008, reason="pod param required")
        return

    def log_generator():
        w = watch.Watch()
        for line in w.stream(
            v1.read_namespaced_pod_log,
            name=pod,
            namespace=ns,
            container=container or None,
            follow=True,
            tail_lines=tail,
            timestamps=True,
            pretty=False,
        ):
            yield line

    async def send_logs():
        loop = asyncio.get_event_loop()
        gen = log_generator()
        while True:
            if ws.client_state == WebSocketState.DISCONNECTED:
                break
            try:
                line = await loop.run_in_executor(None, next, gen)
                await ws.send_text(line)
            except StopIteration:
                break

    try:
        await send_logs()
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        pass
    except Exception:
        pass
    finally:
        try:
            if ws.client_state != WebSocketState.DISCONNECTED:
                await ws.close()
        except RuntimeError:
            pass


# GET /api/deployments/{name}/ingress
@app.get("/api/deployments/{name}/ingress")
async def get_ingress(name: str, namespace: str = "default"):
    try:
        dep = apps_v1.read_namespaced_deployment(name, namespace)
        dep_labels = dict(dep.spec.selector.match_labels or {})

        svc_list = v1.list_namespaced_service(namespace)
        matching_services = set()
        for svc in svc_list.items:
            selector = dict(svc.spec.selector or {})
            if selector and all(dep_labels.get(k) == v for k, v in selector.items()):
                matching_services.add(svc.metadata.name)

        ingress_list = networking_v1.list_namespaced_ingress(namespace)
        result = []
        for ing in ingress_list.items:
            ing_services = set()
            for rule in (ing.spec.rules or []):
                for p in (rule.http.paths if rule.http else []):
                    svc = p.backend.service.name if p.backend and p.backend.service else ""
                    if svc:
                        ing_services.add(svc)

            if ing_services & matching_services:
                rules = []
                for rule in (ing.spec.rules or []):
                    host = rule.host or "*"
                    paths = []
                    for p in (rule.http.paths if rule.http else []):
                        service_name = p.backend.service.name if p.backend and p.backend.service else ""
                        paths.append({"path": p.path or "/", "service": service_name})
                    if paths:
                        rules.append({"host": host, "paths": paths})
                if rules:
                    result.append({"name": ing.metadata.name or "", "rules": rules})
        return result
    except ApiException as e:
        return {"error": str(e)}
