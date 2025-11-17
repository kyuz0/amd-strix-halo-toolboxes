## How to use docker-compose instead of toolbox

## Table of Contents

1.  [Vulkan AMDVLK](#1-vulkanamdvlk)
2.  [ROCm-6.4.4+ROCWMMA](#2-rocm-644-rocwmma)

## 1. Vulkan(AMDVLK)  

1.  Select applicable backend Dockerfile from repo. Example:  
    https://github.com/kyuz0/amd-strix-halo-toolboxes/blob/main/toolboxes/Dockerfile.vulkan-amdvlk
    
2.  In the build file, change shell command to:


```
# shell
CMD ["/bin/bash", "-c", "llama-server --host $HOST --port $PORT -c $CONTEXT_LENGTH --temp $TEMPERATURE --jinja --no-mmap -ngl $NGL -fa $FA -m $MODEL_PATH"]
```

3.  Build container with:

```
docker build -f Dockerfile.vulkan-amdvlk -t vulkan-amdvlk:1.0 .
```

4.  Download your model files to a directory. We will mount this from the container. I use:

```
/mnt/models
```

5.  Create your docker compose, using this template. Change the ports and paths as needed.

```
services:
  gpt-oss-120b:
    container_name: gpt-oss-120b
    image: vulkan-amdvlk:1.0
    ports:
      - "8069:8069"
    volumes:
      - /mnt/models:/mnt/models
    devices:
      - "/dev/dri:/dev/dri"
    privileged: true
    restart: unless-stopped
    environment:
      - HOST=0.0.0.0
      - PORT=8069
      - CONTEXT_LENGTH=120000
      - TEMPERATURE=0.0
      - MODEL_PATH=/mnt/models/gpt-oss-120b-UD-Q4_K_XL/gpt-oss-120b-UD-Q4_K_XL-00001-of-00002.gguf
      - NGL=999
      - FA=on
```

6.  Start as usual.

```
docker compose up -d
```

## 2. ROCm-6.4.4-ROCWMMA  

1.  Select applicable backend Dockerfile from repo. Example:  
    https://github.com/kyuz0/amd-strix-halo-toolboxes/blob/main/toolboxes/Dockerfile.rocm-6.4.4-rocwmma
    
3.  In the build file, change shell command to:
    

```
# shell
CMD ["/bin/bash", "-c", "llama-server --host $HOST --port $PORT -c $CONTEXT_LENGTH --temp $TEMPERATURE --jinja --no-mmap -ngl $NGL -fa $FA -m $MODEL_PATH"]
```

3.  Build container with:

```
docker build -f Dockerfile.rocm-6.4.4-rocwmma -t rocm-6.4.4-rocwmma:1.0 .
```

4.  Download your model files to a directory. We will mount this from the container. I use:

```
/mnt/models
```

5.  Create your docker compose, using this template. Change the ports and paths as needed.

```
services:
  gpt-oss-120b:
    container_name: gpt-oss-120b
    image: rocm-6.4.4-rocwmma:1.0
    ports:
      - "8069:8069"
    volumes:
      - /mnt/models:/mnt/models
    devices:
      - "/dev/dri:/dev/dri"
      - "/dev/kfd:/dev/kfd"
    privileged: true
    restart: unless-stopped
    environment:
      - HOST=0.0.0.0
      - PORT=8069
      - CONTEXT_LENGTH=120000
      - TEMPERATURE=0.0
      - MODEL_PATH=/mnt/models/gpt-oss-120b-UD-Q4_K_XL/gpt-oss-120b-UD-Q4_K_XL-00001-of-00002.gguf
      - NGL=999
      - FA=on
```

6.  Start as usual.

```
docker compose up -d
```
