package app.mahjuris;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.widget.FrameLayout;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;

/** Mahjuris: o jogo HTML roda offline num WebView, servido dos assets por uma origem https fixa
 *  (assim o localStorage, onde ficam baralhos e progresso, persiste entre aberturas). */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String START = "https://" + HOST + "/index.html";
    static final int PICK_FILE = 1001;

    WebView web;
    boolean fullscreen;
    WebView printView;
    PlayBilling billing;
    ValueCallback<Uri[]> pending;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        // Android 15+ desenha a tela de ponta a ponta: o contêiner recua o conteúdo
        // para fora da barra de status, da barra de navegação e do teclado.
        FrameLayout root = new FrameLayout(this);
        root.setFitsSystemWindows(true);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        registerBack();
        web.addJavascriptInterface(new Bridge(), "MJAndroid");
        billing = new PlayBilling(this, web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                try {
                    InputStream in = getAssets().open(path.substring(1));
                    WebResourceResponse r = new WebResourceResponse(mime(path), mime(path).startsWith("text/") || path.endsWith(".js") ? "utf-8" : null, in);
                    Map<String, String> h = new HashMap<String, String>();
                    h.put("Cache-Control", "no-cache");
                    h.put("Access-Control-Allow-Origin", "*");
                    r.setResponseHeaders(h);
                    return r;
                } catch (IOException e) {
                    WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", null);
                    r.setStatusCodeAndReasonPhrase(404, "Not Found");
                    return r;
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                Uri u = Uri.parse(url);
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException e) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (pending != null) pending.onReceiveValue(null);
                pending = cb;
                // .apkg/.colpkg não têm tipo MIME registrado no Android: aceita qualquer arquivo.
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(i, PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    Intent g = new Intent(Intent.ACTION_GET_CONTENT);
                    g.addCategory(Intent.CATEGORY_OPENABLE);
                    g.setType("*/*");
                    try {
                        startActivityForResult(Intent.createChooser(g, "Escolher baralho do Anki"), PICK_FILE);
                    } catch (ActivityNotFoundException e2) {
                        pending = null;
                        cb.onReceiveValue(null);
                        Toast.makeText(MainActivity.this, "Nenhum gerenciador de arquivos encontrado", Toast.LENGTH_LONG).show();
                        return false;
                    }
                }
                return true;
            }
        });

        if (state != null) web.restoreState(state);
        if (web.getUrl() == null) web.loadUrl(START);
    }

    static String mime(String p) {
        p = p.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req != PICK_FILE) { super.onActivityResult(req, res, data); return; }
        if (pending == null) return;
        Uri[] out = null;
        if (res == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                out = new Uri[n];
                for (int k = 0; k < n; k++) out[k] = data.getClipData().getItemAt(k).getUri();
            } else if (data.getData() != null) {
                out = new Uri[]{ data.getData() };
            }
        }
        pending.onReceiveValue(out);
        pending = null;
    }

    /** Voltar: primeiro o jogo trata (diálogo, partida, telas); no menu, manda o app para segundo plano. */
    void handleBack() {
        if (web == null) { moveTaskToBack(true); return; }
        // O jogo decide primeiro (fechar diálogo, sair da partida, voltar ao menu); se não tratar, vai para segundo plano.
        web.evaluateJavascript("(window.mjBack&&window.mjBack())?'1':'0'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String r) {
                if (r != null && r.contains("1")) return;
                if (web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    /** Android 13+ com targetSdk 36: o botão voltar chega por OnBackInvokedCallback, não por
     *  onKeyDown. Registrado por reflexão porque o build compila contra a API 23. */
    void registerBack() {
        if (Build.VERSION.SDK_INT < 33) return;
        try {
            Class<?> cbType = Class.forName("android.window.OnBackInvokedCallback");
            Class<?> dispType = Class.forName("android.window.OnBackInvokedDispatcher");
            Object cb = Proxy.newProxyInstance(getClassLoader(), new Class<?>[]{ cbType }, new InvocationHandler() {
                @Override
                public Object invoke(Object proxy, Method m, Object[] a) {
                    String n = m.getName();
                    if (n.equals("onBackInvoked")) { handleBack(); return null; }
                    if (n.equals("hashCode")) return System.identityHashCode(proxy);
                    if (n.equals("equals")) return a != null && a.length == 1 && proxy == a[0];
                    if (n.equals("toString")) return "MahjurisBack";
                    return null;
                }
            });
            Object disp = Activity.class.getMethod("getOnBackInvokedDispatcher").invoke(this);
            dispType.getMethod("registerOnBackInvokedCallback", int.class, cbType).invoke(disp, 0, cb);
        } catch (Throwable t) { }
    }

    /** Ponte para o jogo: liga e desliga a tela cheia (modo imersivo). */
    class Bridge {
        @JavascriptInterface
        public void setFullscreen(final boolean on) {
            runOnUiThread(new Runnable() { public void run() { fullscreen = on; applyFullscreen(); } });
        }
        @JavascriptInterface
        public void shareFile(final String name, final String mime, final String b64) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
                    File dir = ExportProvider.dir(MainActivity.this); dir.mkdirs();
                    File[] old = dir.listFiles(); if (old != null) for (File o : old) o.delete();
                    File f = new File(dir, safe);
                    FileOutputStream out = new FileOutputStream(f);
                    try { out.write(Base64.decode(b64, Base64.DEFAULT)); } finally { out.close(); }
                    Uri uri = Uri.parse("content://" + ExportProvider.AUTHORITY + "/" + safe);
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType(mime);
                    i.putExtra(Intent.EXTRA_STREAM, uri);
                    i.putExtra(Intent.EXTRA_SUBJECT, safe);
                    i.setClipData(ClipData.newRawUri(safe, uri));
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    Intent ch = Intent.createChooser(i, "Compartilhar ou salvar");
                    ch.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(ch);
                } catch (Throwable t) {
                    Toast.makeText(MainActivity.this, "Não consegui compartilhar o arquivo.", Toast.LENGTH_LONG).show();
                }
            } });
        }
        @JavascriptInterface
        public void printHtml(final String html, final String job) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    final WebView pw = new WebView(MainActivity.this);
                    printView = pw;
                    pw.setWebViewClient(new WebViewClient() {
                        boolean sent;
                        @Override public void onPageFinished(WebView v, String url) {
                            if (sent) return; sent = true;
                            PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                            pm.print(job, v.createPrintDocumentAdapter(job), new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                        }
                    });
                    pw.loadDataWithBaseURL("https://" + HOST + "/", html, "text/html", "utf-8", null);
                } catch (Throwable t) {
                    Toast.makeText(MainActivity.this, "Não consegui abrir a impressão.", Toast.LENGTH_LONG).show();
                }
            } });
        }
        /** Abre a compra da assinatura Premium na Google Play. accountId: id da conta Mahjuris (opcional). */
        @JavascriptInterface
        public void buyPremium(final String accountId) {
            runOnUiThread(new Runnable() { public void run() { if (billing != null) billing.buy(accountId); } });
        }
        @JavascriptInterface
        public void buyPremium() { buyPremium(""); }
        /** Dados da assinatura ativa na Play (JSON com purchaseToken), ou "" se não houver. */
        @JavascriptInterface
        public String playPremium() { return billing == null ? "" : billing.activeJson; }
        /** Token da assinatura ativa na Play, ou "". */
        @JavascriptInterface
        public String playPremiumToken() { return billing == null ? "" : billing.activeToken; }
        /** Preço do plano como a Play mostra (ex.: "R$ 19,90"), ou "". */
        @JavascriptInterface
        public String premiumPrice() { return billing == null ? "" : billing.price(); }
        @JavascriptInterface
        public void refreshPremium() { if (billing != null) billing.refresh(); }
        @JavascriptInterface
        public void copyText(final String text) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(ClipData.newPlainText("Mahjuris", text));
                } catch (Throwable t) { }
            } });
        }
    }

    void applyFullscreen() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                Object ctl = getWindow().getClass().getMethod("getInsetsController").invoke(getWindow());
                int bars = (Integer) Class.forName("android.view.WindowInsets$Type").getMethod("systemBars").invoke(null);
                Class<?> c = Class.forName("android.view.WindowInsetsController");
                if (fullscreen) {
                    c.getMethod("setSystemBarsBehavior", int.class).invoke(ctl, 2); // BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    c.getMethod("hide", int.class).invoke(ctl, bars);
                } else {
                    c.getMethod("show", int.class).invoke(ctl, bars);
                }
                return;
            } catch (Throwable t) { }
        }
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(fullscreen
            ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            : 0);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && fullscreen) applyFullscreen();
    }

    @Override
    public boolean onKeyDown(int code, KeyEvent e) {
        if (code == KeyEvent.KEYCODE_BACK) { handleBack(); return true; }
        return super.onKeyDown(code, e);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        if (billing != null) billing.refresh();
    }

    @Override
    protected void onDestroy() {
        if (billing != null) billing.end();
        super.onDestroy();
    }
}
