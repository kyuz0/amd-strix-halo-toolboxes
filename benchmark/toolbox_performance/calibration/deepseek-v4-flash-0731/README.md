# DeepSeek V4 Flash 0731 ubatch calibration

Depth-0 prefill calibration for `DeepSeek-V4-Flash-0731-UD-IQ2_XXS` using the same benchmark protocol as the full curves: 2,048 prompt tokens, batch 2,048, flash attention enabled, three repetitions, load mode `none`, and all layers offloaded.

Ubatches `256`, `512`, `1024`, and `2048` completed on all three backends. Ubatch `2048` was selected for the full comparison because it produced the highest aggregate throughput across the three toolboxes and was fastest on ROCm 7.14 and the RADV performance fork. Stock RADV alone peaked at ubatch `1024`.

Raw JSONL and stderr output are retained in one subdirectory per toolbox.
