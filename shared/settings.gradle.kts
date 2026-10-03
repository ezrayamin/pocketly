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
