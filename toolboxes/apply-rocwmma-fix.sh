#!/bin/bash

# apply-rocwmma-fix.sh - Apply rocWMMA compatibility fixes to llama.cpp
# Usage: ./apply-rocwmma-fix.sh <path-to-llama.cpp-directory>
# Source: https://github.com/lhl/strix-halo-testing/blob/main/llm-bench/apply-rocwmma-fix.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LLAMA_DIR="${1:-}"

if [[ -z "$LLAMA_DIR" ]]; then
    echo "Usage: $0 <path-to-llama.cpp-directory>"
    echo ""
    echo "This script applies rocWMMA compatibility fixes to a llama.cpp checkout."
    echo "The fixes resolve warp synchronization mask type conflicts between"
    echo "ROCm headers and CUDA-style code when building with GGML_HIP_ROCWMMA_FATTN=ON."
    echo ""
    echo "Example:"
    echo "  $0 ./llama.cpp"
    echo "  $0 /path/to/your/llama.cpp"
    exit 1
fi

if [[ ! -d "$LLAMA_DIR" ]]; then
    echo "Error: Directory '$LLAMA_DIR' does not exist"
    exit 1
fi

if [[ ! -f "$LLAMA_DIR/CMakeLists.txt" ]] || ! grep -q "llama" "$LLAMA_DIR/CMakeLists.txt" 2>/dev/null; then
    echo "Error: '$LLAMA_DIR' does not appear to be a llama.cpp directory"
    echo "Expected to find CMakeLists.txt with 'llama' references"
    exit 1
fi

VENDOR_HIP_FILE="$LLAMA_DIR/ggml/src/ggml-cuda/vendors/hip.h"

if [[ ! -f "$VENDOR_HIP_FILE" ]]; then
    echo "Error: HIP vendor header not found at: $VENDOR_HIP_FILE"
    echo "This script requires a llama.cpp version with HIP support"
    exit 1
fi

echo "Applying rocWMMA compatibility fixes to: $LLAMA_DIR"
echo ""

# Check if fixes are already applied
if grep -q "GGML_HIP_WARP_MASK" "$VENDOR_HIP_FILE" 2>/dev/null; then
    echo "rocWMMA fixes appear to already be applied (found GGML_HIP_WARP_MASK)"
    echo "To reapply, please first revert changes and run this script again"
    exit 0
fi

echo "Step 1: Modifying HIP vendor header..."

# Backup the original file
cp "$VENDOR_HIP_FILE" "$VENDOR_HIP_FILE.backup"

# Find the line with __shfl_sync and __shfl_xor_sync definitions
SHFL_LINE=$(grep -n "^#define __shfl_sync" "$VENDOR_HIP_FILE" | head -1 | cut -d: -f1)

if [[ -z "$SHFL_LINE" ]]; then
    echo "Error: Could not find __shfl_sync macro definition in $VENDOR_HIP_FILE"
    echo "This script may need updates for this version of llama.cpp"
    exit 1
fi

# Create a temporary file with the fix
{
    # Print lines before the __shfl_sync definition
    head -n $((SHFL_LINE - 1)) "$VENDOR_HIP_FILE"
    
    # Add our conditional compilation block
    cat << 'EOF'
#ifdef GGML_HIP_ROCWMMA_FATTN
// ROCm requires 64-bit masks for __shfl_*_sync functions
#define GGML_HIP_WARP_MASK 0xFFFFFFFFFFFFFFFFULL
#else
#define __shfl_sync(mask, var, laneMask, width) __shfl(var, laneMask, width)
#define __shfl_xor_sync(mask, var, laneMask, width) __shfl_xor(var, laneMask, width)
#define GGML_HIP_WARP_MASK 0xFFFFFFFF
#endif
EOF
    
    # Skip the original __shfl_sync and __shfl_xor_sync lines and print the rest
    tail -n +$((SHFL_LINE + 2)) "$VENDOR_HIP_FILE"
    
} > "$VENDOR_HIP_FILE.tmp"

mv "$VENDOR_HIP_FILE.tmp" "$VENDOR_HIP_FILE"

echo "  ✓ Added conditional GGML_HIP_WARP_MASK macro to vendor header"

echo ""
echo "Step 2: Replacing hardcoded warp masks in CUDA files..."

# Find all .cu and .cuh files in the ggml/src/ggml-cuda directory
CUDA_FILES=($(find "$LLAMA_DIR/ggml/src/ggml-cuda" -name "*.cu" -o -name "*.cuh" 2>/dev/null | sort))

if [[ ${#CUDA_FILES[@]} -eq 0 ]]; then
    echo "Warning: No CUDA files found in $LLAMA_DIR/ggml/src/ggml-cuda"
    echo "This may be expected for some llama.cpp versions"
else
    MODIFIED_COUNT=0
    
    for file in "${CUDA_FILES[@]}"; do
        # Check if file contains the hardcoded masks
        if grep -q "0xFFFFFFFF\|0xffffffff" "$file" 2>/dev/null; then
            # Create backup
            cp "$file" "$file.backup"
            
            # Replace both uppercase and lowercase versions
            sed -i 's/0xFFFFFFFF/GGML_HIP_WARP_MASK/g; s/0xffffffff/GGML_HIP_WARP_MASK/g' "$file"
            
            MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
            echo "  ✓ Modified: $(basename "$file")"
        fi
    done
    
    echo "  ✓ Modified $MODIFIED_COUNT CUDA files"
fi

echo ""
echo "Step 3: Verification..."

# Verify the vendor header was modified correctly
if grep -q "GGML_HIP_ROCWMMA_FATTN" "$VENDOR_HIP_FILE" && grep -q "GGML_HIP_WARP_MASK" "$VENDOR_HIP_FILE"; then
    echo "  ✓ Vendor header modification verified"
else
    echo "  ✗ Vendor header modification failed"
    # Restore backup
    mv "$VENDOR_HIP_FILE.backup" "$VENDOR_HIP_FILE"
    echo "  ✓ Restored original vendor header"
    exit 1
fi

echo ""
echo "🎉 rocWMMA compatibility fixes applied successfully!"
echo ""
echo "What was changed:"
echo "  • Added conditional GGML_HIP_WARP_MASK macro to ggml/src/ggml-cuda/vendors/hip.h"
echo "  • Replaced hardcoded 0xFFFFFFFF/0xffffffff with GGML_HIP_WARP_MASK in CUDA files"
echo ""
echo "Behavior:"
echo "  • For regular HIP builds: GGML_HIP_WARP_MASK = 0xFFFFFFFF (no change)"
echo "  • For rocWMMA builds: GGML_HIP_WARP_MASK = 0xFFFFFFFFFFFFFFFFULL (64-bit masks)"
echo ""
echo "To build with rocWMMA support, use:"
echo "  cmake -B build -S '$LLAMA_DIR' -DGGML_HIP=ON -DAMDGPU_TARGETS=\"gfx1151\" -DGGML_HIP_ROCWMMA_FATTN=ON"
echo ""
echo "Backup files were created with .backup extension in case you need to revert."
echo ""
echo "Done! Your llama.cpp checkout now supports rocWMMA builds."