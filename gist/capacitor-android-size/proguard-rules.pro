# R8 rules for a Capacitor release build.
#
# Most of what a Capacitor app links against ships its own consumer rules inside
# the AAR — Capacitor keeps @CapacitorPlugin classes, Firebase keeps its model
# classes, gRPC keeps its service loaders. What is left here is the handful of
# things R8 cannot see from the bytecode alone.

# MainActivity hands the WebView an anonymous @JavascriptInterface object.
# proguard-android-optimize.txt already keeps @JavascriptInterface members, but
# the rule is repeated because losing it is a silent, RELEASE-ONLY breakage:
# the bridge method just returns undefined and nothing throws.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Capacitor instantiates plugin classes by name from the generated plugin list,
# so their no-arg constructors must survive even though nothing calls them.
-keep class com.getcapacitor.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepnames class * implements com.getcapacitor.Plugin

# Crashlytics needs line numbers and the original file name to symbolicate the
# stack traces it uploads. Without these, every release crash report is a list
# of one-letter method names with no line numbers.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Optional transports and annotations these SDKs reference but never load on
# Android. R8 writes the exact list you need into
# app/build/outputs/mapping/release/missing_rules.txt — copy from there rather
# than guessing.
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.naming.**
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**

# The Firebase authentication plugin compiles in a handler for EVERY provider it
# supports, including Facebook, whose SDK is not a dependency here. This is the
# error that fails the first R8 build:
#
#   ERROR: R8: Missing class com.facebook.CallbackManager$Factory
#     (referenced from: ...FacebookAuthProviderHandler...)
-dontwarn com.facebook.**

# Flatten every renamed class into the root package. Play's app-optimisation
# report checks for this ("Repackage classes"); the payoff is a smaller dex —
# each package name is a string in the pool, and 15k classes spread over
# hundreds of packages is a lot of strings nothing reads at runtime.
#
# Safe because R8 leaves anything a -keep rule names where it is, and
# -allowaccessmodification lets it widen package-private access when a class
# does move. Spelled out rather than relied on from full mode's defaults.
-allowaccessmodification
-repackageclasses ''
