import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kmp.library)
}

// Coordinates the RN app resolves through composite-build substitution
// (packages/core-kmp/android/build.gradle → "com.pocketly:pocketly-shared").
group = "com.pocketly"
version = "0.1.0"

kotlin {
    androidLibrary {
        namespace = "com.pocketly.shared"
        compileSdk = 36
        minSdk = 24
    }

    // Host target: runs the BM-PAR-01 contract tests against the shared JSON fixtures.
    jvm()

    val xcf = XCFramework("PocketlyShared")
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "PocketlyShared"
            isStatic = true
            xcf.add(this)
        }
    }

    sourceSets {
        commonMain.dependencies {
            api(libs.kotlinx.coroutines.core) // Flow is part of the public API
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.koin.core)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
        }
    }

    compilerOptions {
        freeCompilerArgs.add("-Xexpect-actual-classes")
    }
}

// Fixtures shared with the TypeScript contract suite (packages/core-contract/fixtures).
tasks.named<Test>("jvmTest") {
    val fixtures = rootDir.resolve("../packages/core-contract/fixtures")
    // Declared as an input so editing a fixture re-runs the parity tests.
    inputs.dir(fixtures).withPropertyName("contractFixtures")
    systemProperty("pocketly.fixtures", fixtures.absolutePath)
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
