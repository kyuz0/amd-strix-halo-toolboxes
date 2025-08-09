git clone https://github.com/ROCm/rocWMMA
cd rocWMMA

# Change FP8 check from FAIL to STATUS

rm -rf build; mkdir build; CC=$ROCM_PATH/llvm/bin/amdclang CXX=$ROCM_PATH/llvm/bin/amdclang++ cmake -B build  . -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=$ROCM_PATH -DROCWMMA_BUILD_TESTS=OFF -DROCWMMA_BUILD_SAMPLES=OFF -DGPU_TARGETS="gfx1151"

cmake --build build -j$(nproc)
sudo cmake --install build