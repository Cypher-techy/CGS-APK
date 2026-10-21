package com.cyphergreensystems.cgs;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * The portal serves several authenticated downloads with Content-Disposition: attachment
 * (/api/reports, /api/gis/export, /api/documents, FERD files). A plain WebView ignores
 * <a download> and those responses, so the tap does nothing. This hands them to Android's
 * DownloadManager instead, carrying the session cookie so authenticated files still resolve.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));

                if (mimeType != null && !mimeType.isEmpty()) {
                    request.setMimeType(mimeType);
                }
                if (userAgent != null) {
                    request.addRequestHeader("User-Agent", userAgent);
                }
                // Authenticated endpoints need the Supabase session cookie.
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null && !cookies.isEmpty()) {
                    request.addRequestHeader("Cookie", cookies);
                }

                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setTitle(fileName);
                request.setDescription("CGS Portal download");
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS, fileName);

                DownloadManager manager =
                        (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (manager != null) {
                    manager.enqueue(request);
                }
            } catch (Exception ignored) {
                // Never let a failed download crash the WebView.
            }
        });
    }
}
