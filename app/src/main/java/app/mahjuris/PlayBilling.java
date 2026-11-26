package app.mahjuris;

import android.app.Activity;
import android.webkit.WebView;
import android.widget.Toast;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONObject;

import java.util.Collections;
import java.util.List;

/**
 * Assinatura "premium" pela Google Play (Play Billing Library).
 * O jogo (plan.js) chama MJAndroid.buyPremium(); quando a Play confirma uma assinatura ativa,
 * avisamos a página com window.mjPremiumChanged({source:"play", productId, purchaseToken, ...}).
 * A validação definitiva (premium_until na conta) é feita no servidor com o purchaseToken.
 */
class PlayBilling implements PurchasesUpdatedListener {
    static final String PRODUCT_ID = "premium";

    final Activity act;
    final WebView web;
    final BillingClient client;
    volatile ProductDetails details;
    volatile String activeToken = "";
    volatile String activeJson = "";
    volatile boolean ready;

    PlayBilling(Activity act, WebView web) {
        this.act = act;
        this.web = web;
        client = BillingClient.newBuilder(act)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
        connect();
    }

    void connect() {
        client.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult r) {
                if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) return;
                ready = true;
                loadDetails();
                refresh();
            }
            @Override public void onBillingServiceDisconnected() { ready = false; }
        });
    }

    void loadDetails() {
        QueryProductDetailsParams p = QueryProductDetailsParams.newBuilder()
            .setProductList(Collections.singletonList(QueryProductDetailsParams.Product.newBuilder()
                .setProductId(PRODUCT_ID)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()))
            .build();
        client.queryProductDetailsAsync(p, (r, result) -> {
            List<ProductDetails> list = result.getProductDetailsList();
            if (r.getResponseCode() == BillingClient.BillingResponseCode.OK && list != null && !list.isEmpty()) details = list.get(0);
        });
    }

    /** Preço formatado do plano (ex.: "R$ 19,90"), ou "" se a Play ainda não respondeu. */
    String price() {
        ProductDetails d = details;
        if (d == null || d.getSubscriptionOfferDetails() == null || d.getSubscriptionOfferDetails().isEmpty()) return "";
        List<ProductDetails.PricingPhase> ph = d.getSubscriptionOfferDetails().get(0).getPricingPhases().getPricingPhaseList();
        return ph.isEmpty() ? "" : ph.get(ph.size() - 1).getFormattedPrice();
    }

    void buy(String accountId) {
        ProductDetails d = details;
        if (!ready || d == null || d.getSubscriptionOfferDetails() == null || d.getSubscriptionOfferDetails().isEmpty()) {
            toast("A assinatura ainda não está disponível. Confira a internet e tente de novo.");
            if (ready) loadDetails(); else connect();
            return;
        }
        // Usa a oferta de menor preço que a Play liberar para esta conta (o plano básico anual, ou uma promoção).
        ProductDetails.SubscriptionOfferDetails best = d.getSubscriptionOfferDetails().get(0);
        BillingFlowParams.ProductDetailsParams pdp = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(d)
            .setOfferToken(best.getOfferToken())
            .build();
        BillingFlowParams.Builder b = BillingFlowParams.newBuilder().setProductDetailsParamsList(Collections.singletonList(pdp));
        if (accountId != null && !accountId.isEmpty()) b.setObfuscatedAccountId(accountId);
        client.launchBillingFlow(act, b.build());
    }

    @Override
    public void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        int code = r.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase p : purchases) handle(p, true);
        } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            refresh();
        } else if (code != BillingClient.BillingResponseCode.USER_CANCELED) {
            toast("A compra não foi concluída. Tente de novo em instantes.");
        }
    }

    /** Consulta as assinaturas da conta Google (ao abrir e ao voltar para o app). */
    void refresh() {
        if (!ready) return;
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(), (r, list) -> {
            if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) return;
            String token = "";
            for (Purchase p : list) {
                if (p.getProducts().contains(PRODUCT_ID) && p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                    token = p.getPurchaseToken();
                    handle(p, false);
                }
            }
            if (token.isEmpty()) { activeToken = ""; activeJson = ""; }
        });
    }

    /** fresh = compra que acabou de acontecer (avisa a página, que valida e recarrega);
     *  nas consultas ao abrir o app só guardamos o token, que o plan.js lê com playPremiumToken(). */
    void handle(final Purchase p, boolean fresh) {
        if (!p.getProducts().contains(PRODUCT_ID)) return;
        if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) {
            toast("Pagamento pendente. O Premium é liberado assim que a Google confirmar.");
            return;
        }
        if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) return;
        if (!p.isAcknowledged()) {
            // Sem reconhecimento em 3 dias a Google devolve o dinheiro.
            client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(), r -> { });
        }
        activeToken = p.getPurchaseToken();
        try {
            JSONObject o = new JSONObject();
            o.put("source", "play");
            o.put("productId", PRODUCT_ID);
            o.put("packageName", act.getPackageName());
            o.put("purchaseToken", p.getPurchaseToken());
            o.put("orderId", p.getOrderId() == null ? "" : p.getOrderId());
            o.put("purchaseTime", p.getPurchaseTime());
            o.put("autoRenewing", p.isAutoRenewing());
            activeJson = o.toString();
        } catch (Exception e) { activeJson = ""; }
        if (fresh) notifyPage(activeJson);
        else {
            final String j = activeJson;
            // A conexão com a Play termina depois que a página abre: avisa sem recarregar.
            act.runOnUiThread(() -> web.evaluateJavascript("window.mjPlayTokenReady&&window.mjPlayTokenReady(" + (j.isEmpty() ? "null" : j) + ")", null));
        }
    }

    void notifyPage(final String json) {
        act.runOnUiThread(() -> web.evaluateJavascript(
            "window.mjPremiumChanged&&window.mjPremiumChanged(" + (json == null || json.isEmpty() ? "null" : json) + ")", null));
    }

    void toast(final String msg) {
        act.runOnUiThread(() -> Toast.makeText(act, msg, Toast.LENGTH_LONG).show());
    }

    void end() { client.endConnection(); }
}
