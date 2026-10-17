pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

// Not "shared": the RN Gradle plugin's own included build already has a `:shared` project.
rootProject.name = "pocketly-shared"

// Benchmark-only code, in perf builds only (bench/build.gradle.kts).
include(":pocketly-shared-bench")
project(":pocketly-shared-bench").projectDir = file("bench")
