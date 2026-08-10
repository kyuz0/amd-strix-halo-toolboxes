#!/usr/bin/env bash

set -euo pipefail

if (( EUID != 0 )); then
    echo "Run this installer with sudo." >&2
    exit 1
fi

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

for required_command in bash ectool grep systemctl systemd-notify timeout tuned-adm; do
    if ! command -v "${required_command}" >/dev/null; then
        echo "Missing required command: ${required_command}" >&2
        exit 1
    fi
done

profiles="$(tuned-adm list)"
for required_profile in accelerator-performance balanced; do
    if ! grep -q -- "- ${required_profile}" <<< "${profiles}"; then
        echo "Missing required TuneD profile: ${required_profile}" >&2
        exit 1
    fi
done

gpu_counter_found=false
for candidate in /sys/class/drm/card*/device/gpu_busy_percent; do
    if [[ -r "${candidate}" ]] && [[ "$(< "${candidate%/gpu_busy_percent}/vendor")" == "0x1002" ]]; then
        gpu_counter_found=true
        break
    fi
done

if [[ "${gpu_counter_found}" != "true" ]]; then
    echo "No AMDGPU gpu_busy_percent counter found." >&2
    exit 1
fi

install -m 0755 "${source_dir}/gpu-workload-watch" /usr/local/sbin/gpu-workload-watch
install -m 0644 "${source_dir}/gpu-workload-watch.service" /etc/systemd/system/gpu-workload-watch.service
systemctl daemon-reload
systemctl enable --now tuned.service
systemctl enable gpu-workload-watch.service
systemctl restart gpu-workload-watch.service
systemctl --no-pager --full status gpu-workload-watch.service
