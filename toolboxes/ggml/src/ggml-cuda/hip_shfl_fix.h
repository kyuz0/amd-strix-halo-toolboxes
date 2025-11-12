#ifndef HIP_SHFL_FIX_H
#define HIP_SHFL_FIX_H
#ifdef __HIP_PLATFORM_AMD__
  #ifndef __shfl_sync
    #define __shfl_sync(mask,var,srcLane,width) __shfl((var),(srcLane),(width))
  #endif
  #ifndef __shfl_up_sync
    #define __shfl_up_sync(mask,var,delta,width) __shfl_up((var),(delta),(width))
  #endif
  #ifndef __shfl_xor_sync
    #define __shfl_xor_sync(mask,var,laneMask,width) __shfl_xor((var),(laneMask),(width))
  #endif
#endif
#endif
