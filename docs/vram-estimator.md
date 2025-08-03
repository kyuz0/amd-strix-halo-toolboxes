---

## docs/vram-estimator.md

---

# 1. Memory Planning with `gguf-vram-estimator.py`

Estimating memory requirements is critical when running large models on Strix Halo (or any GPU with limited RAM). It's not enough to check just the model file size: context length and runtime overheads matter.

This repo provides a tool, **`gguf-vram-estimator.py`**, which reads a `.gguf` model and prints the estimated VRAM needed for different context sizes.

**Why?**

* Helps decide what fits on 32GB, 64GB, 128GB, etc—especially with multi-shard models or large quantized files.

---

## 2. Usage

Make sure you have the estimator script (in `tools/`):

```sh
gguf-vram-estimator.py <path-to-model.gguf>
```

* Supply one or more context lengths to get the corresponding VRAM footprint.
* Handles multi-shard and single-shard models.

---

## 3. Examples

### 3.1 Llama-4-Scout 17B Q4\_K\_XL, up to 1M tokens

```
$ gguf-vram-estimator.py models/llama-4-scout-17b-16e/Q4_K_XL/Llama-4-Scout-17B-16E-Instruct-UD-Q4_K_XL-00001-of-00002.gguf --contexts 4096 32768 1048576

--- Model 'Llama-4-Scout-17B-16E-Instruct' ---
Max Context: 10,485,760 tokens
Model Size: 57.74 GiB
Incl. Overhead: 2.00 GiB

--- Memory Footprint Estimation ---
   Context Size |  Context Memory | Est. Total VRAM
---------------------------------------------------
         4,096 |       1.88 GiB  |      61.62 GiB
        32,768 |      15.06 GiB  |      74.80 GiB
     1,048,576 |      49.12 GiB  |     108.87 GiB
```

* **Takeaway:**

  * Q4\_K quantization allows for a huge context in 128GB, but *processing 1M tokens will be extremely slow* (see benchmark: 200 tokens/sec prompt processing ⇒ almost 1.5 hours for a full 1M context fill).

---

### 3.2 Qwen3-235B Q3\_K XL, high context

```
$ gguf-vram-estimator.py models/qwen3-235B-Q3_K-XL/UD-Q3_K_XL/Qwen3-235B-A22B-Instruct-2507-UD-Q3_K_XL-00001-of-00003.gguf --contexts 65536 131072 262144

--- Memory Footprint Estimation ---
   Context Size |  Context Memory | Est. Total VRAM
---------------------------------------------------
        65,536 |     11.75 GiB |     110.75 GiB
       131,072 |     23.50 GiB |     122.50 GiB
       262,144 |     47.00 GiB |     146.00 GiB
```

* **Takeaway:**

  * With 128GB, you can go up to \~130k context on this Qwen 235B quantized model.
  * If you go higher, you will OOM—even before context reaches the model's max.

---

## 4. Notes

* “Est. Total VRAM” is the minimum you’ll need for the model + context, but does not include OS, other processes, or toolbox/container overhead—leave a margin.
* For detailed methodology or custom scenarios, check the script source.
* Benchmark speed for large context sizes is often the real bottleneck—see `docs/benchmarks.md` for real throughput figures.

---

## 5. Related

* Main README section [Memory Planning & VRAM Estimator](../Readme#4--memory-planning--vram-estimator)
* [docs/benchmarks.md](benchmarks.md) for full speed/compat charts
