#!/usr/bin/env bash

set -e

# List of all known toolboxes and their configurations
declare -A TOOLBOXES

TOOLBOXES["llama-vulkan-amdvlk"]="docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-amdvlk --device /dev/dri --group-add video --security-opt seccomp=unconfined"
TOOLBOXES["llama-vulkan-radv"]="docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv --device /dev/dri --group-add video --security-opt seccomp=unconfined"
TOOLBOXES["llama-rocm-6.4.2"]="docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-6.4.2 --device /dev/dri --device /dev/kfd --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined"
TOOLBOXES["llama-rocm-6.4.2-rocwmma"]="docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-6.4.2-rocwmma --device /dev/dri --device /dev/kfd --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined"
TOOLBOXES["llama-rocm-6.4.3"]="docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-6.4.3 --device /dev/dri --device /dev/kfd --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined"
TOOLBOXES["llama-rocm-6.4.3-rocwmma"]="docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-6.4.3-rocwmma --device /dev/dri --device /dev/kfd --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined"
TOOLBOXES["llama-rocm-7rc"]="docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-7rc --device /dev/dri --device /dev/kfd --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined"
TOOLBOXES["llama-rocm-7rc-rocwmma"]="docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-7rc-rocwmma --device /dev/dri --device /dev/kfd --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined"

function usage() {
  echo "Usage: $0 [all|toolbox-name1 toolbox-name2 ...]"
  echo "Available toolboxes:"
  for name in "${!TOOLBOXES[@]}"; do
    echo "  - $name"
  done
  exit 1
}

# Check dependencies
for cmd in podman toolbox; do
  command -v "$cmd" > /dev/null || { echo "Error: '$cmd' is not installed." >&2; exit 1; }
done

if [ "$#" -lt 1 ]; then
  usage
fi

# Determine which toolboxes to refresh
if [ "$1" = "all" ]; then
  SELECTED_TOOLBOXES=("${!TOOLBOXES[@]}")
else
  SELECTED_TOOLBOXES=()
  for arg in "$@"; do
    if [[ -v TOOLBOXES["$arg"] ]]; then
      SELECTED_TOOLBOXES+=("$arg")
    else
      echo "Error: Unknown toolbox '$arg'"
      usage
    fi
  done
fi

# Loop through selected toolboxes
for name in "${SELECTED_TOOLBOXES[@]}"; do
  config="${TOOLBOXES[$name]}"
  image=$(echo "$config" | awk '{print $1}')
  options="${config#* }"

  echo "🔄 Refreshing $name (image: $image)"

  # Remove the toolbox if it exists
  if toolbox list | grep -q "$name"; then
    echo "🧹 Removing existing toolbox: $name"
    toolbox rm -f "$name"
  fi

  echo "⬇️ Pulling latest image: $image"
  podman pull "$image"

  echo "📦 Recreating toolbox: $name"
  toolbox create "$name" --image "$image" -- $options

  echo "✅ $name refreshed"
  echo
done
