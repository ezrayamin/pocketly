#include <jni.h>
#include <fbjni/fbjni.h>
#include "PocketlyCoreKmpBenchOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::pocketly::bench::registerAllNatives();
  });
}
