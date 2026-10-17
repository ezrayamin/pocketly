plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kmp.library)
}

// Benchmark-only code (BenchCore, BM-10's KotlinCrypto): linked into kmpCorePerf alone, through
// packages/core-kmp-bench → "com.pocketly:pocketly-shared-bench". Release APKs never contain it.
group = "com.pocketly"
version = "0.1.0"

kotlin {
    androidLibrary {
        namespace = "com.pocketly.bench"
        compileSdk = 36
        minSdk = 24
    }
    // Host target for the tests. No iOS: iOS has no perf build yet.
    jvm()

    sourceSets {
        commonMain.dependencies {
            implementation(project(":"))
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlincrypto.hmac.sha2) // BM-10 what-if only, never the PIN (ADR-0010 §8)
        }
        jvmTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.kotlinx.serialization.json)
        }
    }
}

tasks.named<Test>("jvmTest") {
    val fixtures = rootDir.resolve("../packages/core-contract")
    inputs.dir(fixtures.resolve("fixtures")).withPropertyName("contractFixtures")
    systemProperty("pocketly.fixtures", fixtures.resolve("fixtures").absolutePath)
    systemProperty("pocketly.contract", fixtures.resolve("src").absolutePath)
}
