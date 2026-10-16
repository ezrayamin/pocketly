import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.sqldelight)
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
            implementation(libs.sqldelight.runtime)
            implementation(libs.kotlincrypto.hmac.sha2) // BM-10 what-if only, never the PIN (ADR-0010 §8)
        }
        androidMain.dependencies {
            implementation(libs.sqldelight.android.driver) // system SQLite (ADR-0009)
            implementation(libs.androidx.biometric) // BiometricPrompt + CryptoObject (ADR-0012)
        }
        iosMain.dependencies {
            implementation(libs.sqldelight.native.driver) // system SQLite (ADR-0009)
        }
        jvmMain.dependencies {
            implementation(libs.sqldelight.sqlite.driver) // tests only
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

// ADR-0009: two databases, two files. Server = the fake backend's truth; Cache = the app's replica.
sqldelight {
    databases {
        create("ServerDatabase") {
            packageName.set("com.pocketly.shared.db.server")
            srcDirs.setFrom("src/commonMain/sqldelight/server")
        }
        create("CacheDatabase") {
            packageName.set("com.pocketly.shared.db.cache")
            srcDirs.setFrom("src/commonMain/sqldelight/cache")
        }
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
