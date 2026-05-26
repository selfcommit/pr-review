# Capacitor WebView bridge
-keep class com.getcapacitor.** { *; }
-keep class com.prreview.app.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve line numbers for crash reports
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
