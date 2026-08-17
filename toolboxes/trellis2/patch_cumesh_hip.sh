#!/bin/bash
# patch_cumesh_hip.sh — Patch CuMesh sources for HIP/ROCm compilation on gfx1151
#
# CuMesh (https://github.com/JeffreyXiang/CuMesh) is a CUDA-native mesh
# processing library. This script applies the minimal source patches needed
# so that PyTorch's hipify pass + the HIP compiler can build it successfully.
#
# What PyTorch hipify handles automatically:
#   - cub:: -> hipcub::
#   - #include <cub/...> -> #include <hipcub/...>
#   - .cu -> .hip file renaming
#
# What this script patches (things hipify does NOT handle):
#   1. cuda::std::tuple -> rocprim::tuple  (radix sort decomposer in clean_up.cu)
#   2. __device__ -> __host__ __device__    (Vec3f constructors used on host side)
#   3. --extended-lambda removal            (NVCC-only flag, not valid for clang)
#   4. -Wno-c++11-narrowing                 (suppress clang narrowing warnings)

set -e
cd "$1"

echo "=== Patching CuMesh for HIP/ROCm (gfx1151) ==="

# ── 1. clean_up.cu: cuda::std::tuple -> rocprim::tuple ──
echo "Patching clean_up.cu (rocprim::tuple)..."
sed -i '/#include <cub\/cub.cuh>/a #include <rocprim/types/tuple.hpp>' src/clean_up.cu
sed -i 's|::cuda::std::tuple<int\&, int\&, int\&>|::rocprim::tuple<int\&, int\&, int\&>|g' src/clean_up.cu
sed -i 's|cuda::std::tuple|rocprim::tuple|g' src/clean_up.cu
sed -i 's|return {key\.x, key\.y, key\.z};|return ::rocprim::tuple<int\&, int\&, int\&>{key.x, key.y, key.z};|g' src/clean_up.cu

# ── 2. dtypes.cuh: Vec3f __device__ -> __host__ __device__ ──
echo "Patching dtypes.cuh (host+device constructors)..."
sed -i 's|__device__ __forceinline__ Vec3f();|__host__ __device__ __forceinline__ Vec3f();|g' src/dtypes.cuh
sed -i 's|__device__ __forceinline__ Vec3f(float x, float y, float z);|__host__ __device__ __forceinline__ Vec3f(float x, float y, float z);|g' src/dtypes.cuh
sed -i 's|__device__ __forceinline__ Vec3f(float3 v);|__host__ __device__ __forceinline__ Vec3f(float3 v);|g' src/dtypes.cuh
sed -i 's|^__device__ __forceinline__ Vec3f::Vec3f()|__host__ __device__ __forceinline__ Vec3f::Vec3f()|' src/dtypes.cuh
sed -i 's|^__device__ __forceinline__ Vec3f::Vec3f(float x|__host__ __device__ __forceinline__ Vec3f::Vec3f(float x|' src/dtypes.cuh
sed -i 's|^__device__ __forceinline__ Vec3f::Vec3f(float3|__host__ __device__ __forceinline__ Vec3f::Vec3f(float3|' src/dtypes.cuh

# ── 3. setup.py: Add -Wno-c++11-narrowing ──
echo "Patching setup.py (compiler flags)..."
sed -i 's|"-O3", "-std=c++17"|"-O3", "-std=c++17", "-Wno-c++11-narrowing"|g' setup.py

# ── 4. Remove --extended-lambda (NVCC-only flag, not supported by clang/HIP) ──
echo "Removing --extended-lambda flag..."
find . -name 'setup.py' | xargs sed -i '/--extended-lambda/d'

echo "=== CuMesh HIP patch complete ==="
