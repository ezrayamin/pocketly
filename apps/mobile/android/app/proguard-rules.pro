# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# ADR-0009: kmpCore excludes this autolinked package by class name (CorePackages.excludedPackageClasses),
# so R8 must not rename it.
-keepnames class com.op.sqlite.OPSQLitePackage

# ADR-0016 §7: react-native-data-scanner 0.1.2 uses Google's code scanner (play-services-code-scanner 16.1.0);
# minified, GmsBarcodeScanning.getClient threw a NullPointerException inside ML Kit (vivo V2538, 2026-10-30; the
# debug build worked). ML Kit finds its component registrars by name (manifest meta-data) and creates them with
# their no-arg constructor. firebase-components 16.1.0's rule (-keep class * implements ComponentRegistrar) predates
# R8 full mode, which no longer keeps that constructor implicitly, so ML Kit found no components. Keep it.
-keep class * implements com.google.firebase.components.ComponentRegistrar { void <init>(); }
