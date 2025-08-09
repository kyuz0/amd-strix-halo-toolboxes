
# Building Containers Locally

If you want to build or customize the toolbox containers yourself (rather than using the pre-built Docker Hub images), this guide explains the process. Local builds are useful if you want to:

* Use a patched or forked version of llama.cpp
* Add additional tools or libraries
* Change the Fedora base image (Rawhide vs. stable)
* Audit every installed dependency

---

## 1. Prerequisites

* **Podman** (recommended on Fedora) or **Docker** (also fine)

---

## 2. Build an Image

Each backend has its own subdirectory and Dockerfile in `toolboxes/`.

**Example: Build the Vulkan RADV toolbox image**

```sh
cd toolboxes
podman build --no-cache -t llama-vulkan-radv -f Dockerfile.vulkan-radv .
```

**Example: Build the ROCm 6.4.2 toolbox image**

```sh
cd toolboxes
podman build --no-cache -t llama-rocm-6.4.2 -f Dockerfile.rocm-6.4.2 .
```

> You can use `docker build` if you prefer Docker.

---

## 3. Customizing the Build

* **llama.cpp version**: Change the `git clone` or `git checkout` line in the Dockerfile.
* **Extra dependencies**: Add them to the Dockerfile as needed.
* **Other customizations**: Install tools, patch scripts, or swap to a different base image.

---

## 4. Using the Custom Image with Toolbx

Create a new toolbox using your freshly built image:

```sh
toolbox create llama-vulkan-radv --image localhost/llama-vulkan-radv \
  -- --device /dev/dri --group-add video --security-opt seccomp=unconfined
```

Replace the backend/image name and device/group options as needed (see main README Section 2.1).

---

## 5. Troubleshooting

* **Build fails (ROCm images especially):** Try building with more memory or swap.
* **Toolbox can't access GPU:** Make sure you pass the correct device/group options.

---

## 6. References

* [Fedora Toolbox Documentation](https://docs.fedoraproject.org/en-US/fedora-silverblue/toolbox/)
* [Podman Build Reference](https://docs.podman.io/en/latest/markdown/podman-build.1.html)
* [Docker Build Reference](https://docs.docker.com/engine/reference/commandline/build/)


