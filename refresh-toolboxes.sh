#!/usr/bin/env bash

set -e

# List of all known toolboxes and their configurations
declare -A TOOLBOXES

TOOLBOXES["llama-vulkan-amdvlk"]="docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-amdvlk --device /dev/dri --group-add video --security-opt seccomp=unconfined"
TOOLBOXES["llama-vulkan-radv"]="docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv --device /dev/dri --group-add video --security-opt seccomp=unconfined"
TOOLBOXES["llama-rocm-6.4.4"]="docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-6.4.4 --device /dev/dri --device /dev/kfd --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined"
TOOLBOXES["llama-rocm-7.2"]="docker.io/kyuz0/amd-strix-halo-toolboxes:rocm-7.2 --device /dev/dri --device /dev/kfd --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined"
TOOLBOXES["llama-rocm7-nightlies"]="docker.io/kyuz0/amd-strix-halo-toolboxes:rocm7-nightlies --device /dev/dri --device /dev/kfd --group-add video --group-add render --group-add sudo --security-opt seccomp=unconfined"

function usage() {
  echo "Usage: $0 [all|toolbox-name1 toolbox-name2 ...]"
  echo "Available toolboxes:"
  for name in "${!TOOLBOXES[@]}"; do
    echo "  - $name"  
  done
  exit 1
}

# Check OS and set appropriate toolbox command
IS_UBUNTU=false
if [ -f /etc/os-release ]; then
  . /etc/os-release
  if [ "$ID" = "ubuntu" ]; then
    IS_UBUNTU=true
  fi
fi

if [ "$IS_UBUNTU" = true ]; then
  TOOLBOX_CMD="distrobox"
else
  TOOLBOX_CMD="toolbox"
fi

# Check dependencies
DEPENDENCIES=("podman" "$TOOLBOX_CMD")
for cmd in "${DEPENDENCIES[@]}"; do
  if ! command -v "$cmd" > /dev/null; then
    if [ "$cmd" = "distrobox" ] && [ "$IS_UBUNTU" = true ]; then
      echo "Error: 'distrobox' is not installed. Ubuntu users must use distrobox instead of toolbox." >&2
      echo "Please install distrobox (e.g., sudo apt install distrobox) and try again." >&2
    else
      echo "Error: '$cmd' is not installed." >&2
    fi
    exit 1
  fi
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
  if $TOOLBOX_CMD list | grep -q "$name"; then
    echo "🧹 Removing existing toolbox: $name"
    $TOOLBOX_CMD rm -f "$name"
  fi

  echo "⬇️ Pulling latest image: $image"
  podman pull "$image"



  echo "📦 Recreating toolbox: $name"
  $TOOLBOX_CMD create "$name" --image "$image" -- $options

  # --- Cleanup: remove dangling images ---
  repo="${image%:*}"

  # Remove dangling images from this repository (typically prior pulls of this tag)
  while read -r id; do
    podman image rm -f "$id" >/dev/null 2>&1 || true
  done < <(podman images --format '{{.ID}} {{.Repository}}:{{.Tag}}' \
           | awk -v r="$repo" '$2==r":<none>" {print $1}')
  # --- end cleanup ---

  echo "✅ $name refreshed"
  echo
done
