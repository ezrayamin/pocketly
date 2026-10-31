project(PocketlyCoreKmp)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME PocketlyCoreKmp)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

add_library(${PACKAGE_NAME} SHARED
  src/main/cpp/cpp-adapter.cpp
)

# Nitrogen-generated JNI bridge (HybridObject specs, structs, callbacks).
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/PocketlyCoreKmp+autolinking.cmake)

include_directories("src/main/cpp")

find_library(LOG_LIB log)
target_link_libraries(${PACKAGE_NAME} ${LOG_LIB} android)

# Size: export only JNI_OnLoad (JNIEXPORT). With default visibility every generated C++ symbol was exported, and
# their names (.dynstr, .dynsym) were ~30% of the library. Nitro's base classes stay imported from
# libNitroModules.so, so casts across the libraries are unaffected. -Os was measured too: no gain.
target_compile_options(${PACKAGE_NAME} PRIVATE -fvisibility=hidden -fvisibility-inlines-hidden)
