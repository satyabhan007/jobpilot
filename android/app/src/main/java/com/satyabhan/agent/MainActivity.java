package com.satyabhan.agent;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import androidx.appcompat.app.AppCompatActivity;

/**
 * JobPilot personal agent — hybrid WebView shell.
 *
 * Loading strategy: REMOTE-FIRST, LOCAL-FALLBACK.
 *
 *   1. Try the GitHub Pages build (REMOTE_URL). That hosted copy is always the
 *      newest version of the app: push to the repo and every device picks the
 *      update up on next open — no APK rebuild, no reinstall. The https origin
 *      is also the only kind of origin Google accepts for Gmail OAuth, so
 *      multi-Gmail sign-in works here but can never work on a file:// page.
 *
 *   2. If the network or the site is unreachable, fall back to the copy bundled
 *      inside this APK (assets/www). Offline you still get job boards, demo
 *      data, local matching and your saved/dismissed jobs; Gmail sign-in
 *      requires the hosted (online) version.
 *
 * Access control: the hosted app is gated by the app's own lock screen
 * (js/githubauth.js) — only the GitHub account holder configured in
 * js/portfolio.js (githubOwner) can unlock it. The bundled offline copy is not
 * gated because it never leaves the device.
 *
 * Navigation policy: this WebView stays dedicated to the app. Only the app
 * origin and the two sign-in providers (Google, GitHub) may navigate here;
 * every other link (job apply pages, etc.) opens in the device's real browser.
 */
public class MainActivity extends AppCompatActivity {

    /** Hosted app URL (repo "jobpilot" on the satyabhan007 account).
     *  If you deploy under a different repo or user name, change this one
     *  constant — nothing else needs to move. */
    private static final String REMOTE_URL = "https://satyabhan007.github.io/jobpilot/";

    /** Bundled copy used when the hosted app cannot be reached. */
    private static final String FALLBACK_URL = "file:///android_asset/www/index.html";

    /** Origins this WebView is allowed to navigate to. */
    private static final String[] ALLOWED_HOSTS = {
            "satyabhan007.github.io",   // the hosted app (Pages)
            "accounts.google.com",      // Gmail OAuth consent / token exchange
            "github.com"                // GitHub device-flow sign-in for the gate
    };

    private WebView webView;
    private boolean usingFallback = false;
    private boolean fallbackTried = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Only affect file:// (fallback) pages; remote pages are https and
        // cannot read local files regardless.
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setDatabaseEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost() == null ? "" : uri.getHost();

                for (String allowed : ALLOWED_HOSTS) {
                    if (host.equalsIgnoreCase(allowed)) {
                        return false; // navigate inside the app WebView
                    }
                }
                // Everything else (apply links, company sites) → real browser.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                // Only the main frame falling over means "site unreachable".
                if (request.isForMainFrame() && !usingFallback && !fallbackTried) {
                    useFallback();
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            android.webkit.WebResourceResponse errorResponse) {
                // e.g. 404 before the Pages site is published for this repo.
                if (request.isForMainFrame() && !usingFallback && !fallbackTried) {
                    useFallback();
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        // Remote-first: always try the newest hosted build.
        webView.loadUrl(REMOTE_URL);
    }

    /** Switch to the copy bundled in the APK (offline / site not deployed yet). */
    private void useFallback() {
        fallbackTried = true;
        usingFallback = true;
        webView.loadUrl(FALLBACK_URL);
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
