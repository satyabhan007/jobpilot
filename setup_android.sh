#!/bin/bash
set -e

APP_NAME="PocketAgent"
PKG="com.satyabhan.agent"
OUT_DIR="android"

mkdir -p "$OUT_DIR/app/src/main/java/com/satyabhan/agent"
mkdir -p "$OUT_DIR/app/src/main/res/values"
mkdir -p "$OUT_DIR/app/src/main/assets/www"

# Copy all webapp files to assets (excluding android itself)
cp -r css js tests index.html "$OUT_DIR/app/src/main/assets/www/"

# build.gradle (Project)
cat <<EOF > "$OUT_DIR/build.gradle"
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath "com.android.tools.build:gradle:8.1.1"
    }
}
allprojects {
    repositories {
        google()
        mavenCentral()
    }
}
EOF

# settings.gradle
cat <<EOF > "$OUT_DIR/settings.gradle"
include ':app'
EOF

# app/build.gradle
cat <<EOF > "$OUT_DIR/app/build.gradle"
plugins {
    id 'com.android.application'
}

android {
    namespace 'com.satyabhan.agent'
    compileSdk 34

    defaultConfig {
        applicationId "com.satyabhan.agent"
        minSdk 24
        targetSdk 34
        versionCode 1
        versionName "1.0"
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.android.material:material:1.9.0'
    implementation 'androidx.webkit:webkit:1.8.0'
}
EOF

# AndroidManifest.xml
cat <<EOF > "$OUT_DIR/app/src/main/AndroidManifest.xml"
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.satyabhan.agent">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="$APP_NAME"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.AppCompat.Light.NoActionBar"
        android:usesCleartextTraffic="true">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|keyboardHidden|screenSize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
EOF

# styles.xml
cat <<EOF > "$OUT_DIR/app/src/main/res/values/styles.xml"
<resources>
    <style name="Theme.AppCompat.Light.NoActionBar" parent="Theme.AppCompat.Light">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
    </style>
</resources>
EOF

# MainActivity.java
cat <<EOF > "$OUT_DIR/app/src/main/java/com/satyabhan/agent/MainActivity.java"
package com.satyabhan.agent;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setDatabaseEnabled(true);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        
        // Load the web app
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
EOF

# Gradle Wrapper (using local gradle)
cd "$OUT_DIR"
gradle wrapper --gradle-version 8.3
echo "Android project created successfully in $OUT_DIR"
