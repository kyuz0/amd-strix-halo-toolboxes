# TODO

## Revisit the temporary llama.cpp ROCm host-buffer patch

- [ ] Review `toolboxes/llama-cpp-25992-rocm-host-buffer.patch`, the workaround for [llama.cpp #25992](https://github.com/ggml-org/llama.cpp/issues/25992) based on [#25863](https://github.com/ggml-org/llama.cpp/pull/25863). It is applied by `rocm-10.0`, `therock-nightly`, `rocm-10.0-qwen-3.8-flash-next`, and `rocm-10.0-engramhalo`.
- [ ] Dropped from `rocm-10.0-strix-llama`: `halo-box/strix-llama.cpp` refactored the pinned-memory checks into `ggml_cuda_pinned_memory_disabled()`, so the hunks match nothing. Test multi-slot inference on that image; if #25992 still shows there, re-add an integrated-GPU guard written against the new helper.
- [ ] Account for merged [#28604](https://github.com/ggml-org/llama.cpp/pull/28604): it reverts HIP integrated-GPU detection, so the patch still applies to upstream `master` but its integrated-GPU host-buffer guard is currently redundant there. It is a broader stopgap, not the same fix as #25863.
- [ ] Before removing the patch from the upstream-based images (`rocm-10.0` and `therock-nightly`), test multi-slot inference on Strix Halo for the response mix-up in #25992, plus memory use and throughput. Check each fork-based image separately; its source may not contain #28604.
- [ ] Revisit the patch when [#27311](https://github.com/ggml-org/llama.cpp/pull/27311) lands or upstream changes HIP integrated-GPU support again. Update the affected Dockerfiles and the temporary-workaround note in `README.md` together.
