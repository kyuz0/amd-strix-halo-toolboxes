# Source: https://github.com/lhl/strix-halo-testing/blob/main/llm-bench/build-rocwmma.sh
git clone https://github.com/ROCm/rocWMMA
cd rocWMMA

# --- BEGIN: make OpenMP explicit for ROCm toolchains (drop-in) ---
# find libomp (check ROCM_PATH first, then system)
CANDIDATES=(
  "${ROCM_PATH}/llvm/lib/libomp.so"
  "${ROCM_PATH}/llvm/lib/libomp.a"
  "/usr/lib64/libomp.so"
  "/usr/lib64/libomp.a"
  "/usr/local/lib/libomp.so"
)
FOUND_LIBOMP=""
for p in "${CANDIDATES[@]}"; do
  if [ -f "$p" ]; then
    FOUND_LIBOMP="$p"
    break
  fi
done

CMAKE_OPTS=""
if [ -n "$FOUND_LIBOMP" ]; then
  # directory & basename
  OMP_LIB_DIR="$(dirname "$FOUND_LIBOMP")"
  OMP_LIB_BASENAME="$(basename "$FOUND_LIBOMP")"
  # set cache vars so FindOpenMP will succeed
  CMAKE_OPTS="${CMAKE_OPTS} -DOpenMP_CXX_FLAGS=-fopenmp=libomp"
  CMAKE_OPTS="${CMAKE_OPTS} -DOpenMP_C_FLAGS=-fopenmp=libomp"
  CMAKE_OPTS="${CMAKE_OPTS} -DOpenMP_CXX_LIB_NAMES=omp"
  CMAKE_OPTS="${CMAKE_OPTS} -DOpenMP_C_LIB_NAMES=omp"
  CMAKE_OPTS="${CMAKE_OPTS} -DOpenMP_LIBRARY=${FOUND_LIBOMP}"
  CMAKE_OPTS="${CMAKE_OPTS} -DOpenMP_INCLUDE_DIR=${ROCM_PATH}/llvm/include"
  export LD_LIBRARY_PATH="${OMP_LIB_DIR}${LD_LIBRARY_PATH:+:}$LD_LIBRARY_PATH"
  export CXXFLAGS="-fopenmp=libomp ${CXXFLAGS:-}"
  export LDFLAGS="-L${OMP_LIB_DIR} -lomp ${LDFLAGS:-}"
else
  # fallback: force flags so FindOpenMP might at least get flags
  CMAKE_OPTS="${CMAKE_OPTS} -DOpenMP_CXX_FLAGS=-fopenmp=libomp -DOpenMP_C_FLAGS=-fopenmp=libomp"
  export CXXFLAGS="-fopenmp=libomp ${CXXFLAGS:-}"
  export LDFLAGS="${LDFLAGS:-} -lomp"
fi
# ---  END: make OpenMP explicit  ---

CC=$ROCM_PATH/llvm/bin/amdclang \
CXX=$ROCM_PATH/llvm/bin/amdclang++ \
cmake -B build -S . -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX=$ROCM_PATH \
  -DROCWMMA_BUILD_TESTS=OFF \
  -DROCWMMA_BUILD_SAMPLES=OFF \
  -DGPU_TARGETS="gfx1151" \
  -DOpenMP_CXX_FLAGS="-fopenmp=libomp" \
  -DOpenMP_C_FLAGS="-fopenmp=libomp" \
  -DOpenMP_omp_LIBRARY="/usr/lib64/libomp.so" \
  -DOpenMP_CXX_LIB_NAMES="omp" \
  -DOpenMP_C_LIB_NAMES="omp" \
  -DOpenMP_INCLUDE_DIRS="/usr/lib64/clang/19/include"

cmake --install build
sudo cmake --install build