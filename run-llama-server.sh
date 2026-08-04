#!/bin/bash

# Default-Werte
CONTAINER_NAME="llamacpp-server"
PORT=11434
CTX_SIZE=65536
GPU_LAYERS=999
THREADS=12
MODEL_PATH=""
API_KEY=""
IMAGE="docker.io/st3v0rr/amd-strix-halo-toolboxes:vulkan-radv"
MODELS_DIR="./models"
# Auf Strix Halo laut Upstream-README zwingend: Flash Attention und kein
# mmap, sonst drohen Abstuerze und Einbrueche bei der Geschwindigkeit.
#
# Die README nennt dafuer noch "-fa 1 --no-mmap". Beide Schreibweisen sind in
# aktuellem llama.cpp veraltet: --no-mmap warnt beim Start und entspricht
# "--load-mode none", -fa erwartet inzwischen on|off|auto.
EXTRA_ARGS="-fa on --load-mode none"

# Hilfe-Funktion
show_help() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Options:
    --model PATH        Pfad zum Modell, relativ zum Modellverzeichnis
                        ($MODELS_DIR). Ein fuehrendes "models/" darf mit
                        angegeben werden und wird abgeschnitten.
    --api-key KEY       API-Key fuer den Server
    --image IMAGE       Docker/Podman Image (default: $IMAGE)
    --port PORT         Host-Port, im Container lauscht der Server immer auf
                        11434 (default: $PORT)
    --ctx-size SIZE     Context Size (default: $CTX_SIZE)
    --gpu-layers NUM    Anzahl GPU Layers (default: $GPU_LAYERS)
    --threads NUM       Anzahl Threads (default: $THREADS)
    --name NAME         Container Name (default: $CONTAINER_NAME)
    --models-dir DIR    Modellverzeichnis auf dem Host (default: $MODELS_DIR)
    --extra-args ARGS   Zusaetzliche llama-server-Argumente
                        (default: "$EXTRA_ARGS")
    --help              Zeigt diese Hilfe

Beispiele:

  Vulkan RADV (Default, stabilste Variante):
    $(basename "$0") \\
      --model Qwen3-VL-235B-A22B-Instruct-GGUF/UD-Q3_K_XL/Qwen3-VL-235B-A22B-Instruct-UD-Q3_K_XL-00001-of-00003.gguf \\
      --api-key example-key

  Vulkan AMDVLK (schneller, aber 2-GiB-Limit pro Buffer):
    $(basename "$0") \\
      --image docker.io/st3v0rr/amd-strix-halo-toolboxes:vulkan-amdvlk \\
      --name llama-vulkan-amdvlk \\
      --model Qwen3.6-27B-GGUF/Q8_0/Qwen3.6-27B-Q8_0.gguf \\
      --api-key example-key

  ROCm 7.14 (aktuellstes stabiles ROCm):
    $(basename "$0") \\
      --image docker.io/st3v0rr/amd-strix-halo-toolboxes:rocm-7.14 \\
      --name llama-rocm-7.14 \\
      --model Qwen3.6-35B-A3B-GGUF/UD-Q4_K_XL/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf \\
      --api-key example-key

  ROCm 6.4.4 (stabiler 6.x-Zweig):
    $(basename "$0") \\
      --image docker.io/st3v0rr/amd-strix-halo-toolboxes:rocm-6.4.4 \\
      --name llama-rocm-6.4.4 \\
      --model gpt-oss-120b-GGUF/F16/gpt-oss-120b-F16.gguf \\
      --api-key example-key \\
      --ctx-size 90000

  Zweiter Server parallel auf anderem Port:
    $(basename "$0") \\
      --image docker.io/st3v0rr/amd-strix-halo-toolboxes:rocm-7.14 \\
      --name llama-rocm-7.14-second \\
      --port 11435 \\
      --model Qwen3.6-27B-GGUF/Q8_0/Qwen3.6-27B-Q8_0.gguf \\
      --api-key example-key
EOF
}

# Argument-Parsing
while [[ $# -gt 0 ]]; do
    case $1 in
        --model)
            MODEL_PATH="$2"
            shift 2
            ;;
        --api-key)
            API_KEY="$2"
            shift 2
            ;;
        --image)
            IMAGE="$2"
            shift 2
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --ctx-size)
            CTX_SIZE="$2"
            shift 2
            ;;
        --gpu-layers)
            GPU_LAYERS="$2"
            shift 2
            ;;
        --threads)
            THREADS="$2"
            shift 2
            ;;
        --name)
            CONTAINER_NAME="$2"
            shift 2
            ;;
        --models-dir)
            MODELS_DIR="$2"
            shift 2
            ;;
        --extra-args)
            EXTRA_ARGS="$2"
            shift 2
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            echo "Unbekannte Option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validierung
if [ -z "$MODEL_PATH" ]; then
    echo "Fehler: --model ist erforderlich"
    show_help
    exit 1
fi

if [ -z "$API_KEY" ]; then
    echo "Fehler: --api-key ist erforderlich"
    show_help
    exit 1
fi

if [ ! -d "$MODELS_DIR" ]; then
    echo "Fehler: Modellverzeichnis '$MODELS_DIR' existiert nicht."
    echo "Lege es an oder gib es mit --models-dir an."
    exit 1
fi

# Modellpfad normalisieren: der Host mountet $MODELS_DIR nach /workspace/models.
# Ein fuehrendes "models/" ist daher redundant und wird entfernt, damit beide
# Schreibweisen funktionieren.
REL_MODEL_PATH="${MODEL_PATH#models/}"
REL_MODEL_PATH="${REL_MODEL_PATH#/}"

# Vor dem Start pruefen, ob das Modell ueberhaupt da ist. Sonst startet der
# Container, llama-server bricht ab und --restart erzeugt eine stille
# Crash-Loop.
if [ ! -f "${MODELS_DIR}/${REL_MODEL_PATH}" ]; then
    echo "Fehler: Modell nicht gefunden: ${MODELS_DIR}/${REL_MODEL_PATH}"
    echo "Der Pfad wird relativ zu '${MODELS_DIR}' aufgeloest."
    exit 1
fi

# Vollstaendiger Modell-Pfad im Container
FULL_MODEL_PATH="/workspace/models/${REL_MODEL_PATH}"

# Pruefe ob Container bereits laeuft
if podman ps -a --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "Container $CONTAINER_NAME existiert bereits. Stoppe und entferne ihn..."
    podman stop "$CONTAINER_NAME" 2>/dev/null
    podman rm "$CONTAINER_NAME" 2>/dev/null
fi

echo "Starte Container mit folgenden Einstellungen:"
echo "  Container Name: $CONTAINER_NAME"
echo "  Image:          $IMAGE"
echo "  Model (Host):   ${MODELS_DIR}/${REL_MODEL_PATH}"
echo "  Model (Cont.):  $FULL_MODEL_PATH"
echo "  Port:           ${PORT} -> 11434"
echo "  Context Size:   $CTX_SIZE"
echo "  GPU Layers:     $GPU_LAYERS"
echo "  Threads:        $THREADS"
echo "  Extra Args:     $EXTRA_ARGS"
echo ""

# Container starten.
#
# Der llama-server-Aufruf wird hier explizit uebergeben und ueberschreibt damit
# den CMD des Images. Nur so lassen sich zusaetzliche Argumente wie -fa 1 und
# --no-mmap durchreichen; der CMD im Image kennt dafuer keine Variable.
# $EXTRA_ARGS ist absichtlich nicht gequotet, damit mehrere Argumente in
# einzelne Worte zerfallen.
podman run -d \
  --restart unless-stopped \
  --device /dev/dri \
  --device /dev/kfd \
  --group-add video \
  --group-add render \
  --security-opt seccomp=unconfined \
  -p "${PORT}:11434" \
  --name "$CONTAINER_NAME" \
  -v "${MODELS_DIR}:/workspace/models:z" \
  "$IMAGE" \
  llama-server \
    -m "$FULL_MODEL_PATH" \
    --jinja \
    --port 11434 \
    --host 0.0.0.0 \
    --ctx-size "$CTX_SIZE" \
    --n-gpu-layers "$GPU_LAYERS" \
    --threads "$THREADS" \
    --api-key "$API_KEY" \
    $EXTRA_ARGS

if [ $? -eq 0 ]; then
    echo ""
    echo "Container erfolgreich gestartet!"
    echo "Logs anzeigen: podman logs -f $CONTAINER_NAME"
else
    echo ""
    echo "Fehler beim Starten des Containers!"
    exit 1
fi
