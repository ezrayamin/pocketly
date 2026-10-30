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

# ADR-0016 §7: react-native-data-scanner 0.1.2 uses Google's code scanner (play-services-code-scanner 16.1.0),
# which ships no R8 rules; minified, GmsBarcodeScanning.getClient throws a NullPointerException inside ML Kit
# (vivo V2538, 2026-10-30; the debug build works). ML Kit wires its pieces up by reflection, so keep them whole.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_code_scanner.** { *; }
-keep class com.google.android.gms.internal.mlkit_common.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_common.** { *; }
