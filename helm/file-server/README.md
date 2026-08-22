# file-server

Helm chart for the internal S3-backed file server (Next.js standalone build).
Stateless by design: all data lives in Ceph RGW, so no PVCs are required.

## Prerequisites

- Kubernetes 1.23+
- An S3-compatible endpoint reachable from the cluster (Ceph RGW)
- Ingress controller (nginx) if `ingress.enabled=true`
- Helm 3

## Installing the chart

Credentials should live in a Secret created out-of-band, not in chart values:

```sh
kubectl -n file-server create secret generic file-server-s3 \
  --from-literal=S3_ACCESS_KEY='...' \
  --from-literal=S3_SECRET_KEY='...'
```

```sh
helm upgrade --install file-server ./helm/file-server \
  --namespace file-server --create-namespace \
  --set config.s3Endpoint=https://s3.internal.example.com \
  --set s3.existingSecret=file-server-s3
```

## Uninstalling

```sh
helm uninstall file-server -n file-server
```

The chart-managed Secret (if one was rendered from values) is removed with the
release; an out-of-band Secret is left untouched.

## Values

| Key | Default | Description |
| --- | --- | --- |
| `replicaCount` | `2` | Number of replicas (ignored when `autoscaling.enabled`) |
| `image.repository` | `ghanad/mazin` | Image repository |
| `image.tag` | `""` | Defaults to `.Chart.AppVersion` |
| `image.pullPolicy` | `IfNotPresent` | Pull policy |
| `imagePullSecrets` | `[]` | Registry credentials |
| `nameOverride` / `fullnameOverride` | `""` | Resource-name overrides |
| `serviceAccount.create` | `true` | Create a dedicated ServiceAccount (token not mounted) |
| `serviceAccount.name` | `""` | Override the generated name |
| `podAnnotations` / `podLabels` | `{}` | Extra pod metadata |
| `hostAliases` | `[]` | Static hostname-to-IP mappings added to each pod's `/etc/hosts` |
| `podSecurityContext` | non-root uid/gid 1001, RuntimeDefault seccomp | Pod-level security |
| `securityContext` | no privilege escalation, read-only rootfs, all caps dropped | Container-level security |
| `strategy` | RollingUpdate, maxUnavailable 0 | Deployment strategy |
| `service.type` | `ClusterIP` | Service type |
| `service.port` | `80` | Service port (targets container port 3000) |
| `ingress.enabled` | `true` | Create the Ingress |
| `ingress.className` | `nginx` | Ingress class |
| `ingress.annotations` | body-size 0, proxy buffering off | Streaming-friendly nginx settings |
| `ingress.hosts` | `files.internal.example.com` | Hosts/paths |
| `ingress.tls` | `[]` | TLS entries |
| `config.*` | see `values.yaml` | Non-sensitive env (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `APP_BASE_URL`, `UPLOAD_PART_SIZE_MB`, `PRESIGN_EXPIRY_SECONDS`, `LOG_LEVEL`) |
| `s3.existingSecret` | `""` | Name of an existing Secret with `S3_ACCESS_KEY` / `S3_SECRET_KEY` |
| `s3.accessKey` / `s3.secretKey` | `""` | Chart-managed Secret fallback (avoid; leaks into release metadata) |
| `resources` | 100m/128Mi requests, 512Mi memory limit | Container resources |
| `livenessProbe` | `/api/health` | Liveness probe |
| `readinessProbe` | `/api/health/ready` (HeadBucket deep check) | Readiness probe |
| `extraVolumes` / `extraVolumeMounts` | `[]` | Additional volumes |
| `autoscaling.enabled` | `false` | Enable HPA |
| `autoscaling.minReplicas` / `maxReplicas` | `2` / `5` | HPA bounds |
| `autoscaling.targetCPUUtilizationPercentage` | `80` | CPU target |
| `nodeSelector` / `tolerations` / `affinity` | `{}` / `[]` / `{}` | Scheduling |

## Notes

- The Deployment pods get checksum annotations for the ConfigMap and
  chart-managed Secret, so credential or config changes trigger a rolling restart.
- If neither `s3.existingSecret` nor `s3.accessKey`/`s3.secretKey` is set, the
  Secret is not rendered and rollout will not become ready until credentials exist.
