# Mahjuris para Android (build com Gradle e cobrança da Play)

O app é um WebView que carrega `app/src/main/assets/index.html` (o mesmo jogo do site).
A assinatura Premium usa a Google Play Billing Library (`PlayBilling.java`).

## Build automático (GitHub Actions)

Cada push na branch `main` gera o AAB (para a Play) e o APK (para testar) em
**Actions > Gerar AAB e APK > Artifacts**.

Segredos do repositório (Settings > Secrets and variables > Actions):

| Segredo | Conteúdo |
|---|---|
| `UPLOAD_KEYSTORE_BASE64` | a chave de upload `upload-keystore.p12` em base64 |
| `UPLOAD_KEYSTORE_PASSWORD` | a senha da chave |

A chave nunca vai para o código (`*.p12` está no `.gitignore`).

## Nova versão

1. Aumente `versionCode` e `versionName` em `app/build.gradle.kts`.
2. Copie os assets atualizados do jogo para `app/src/main/assets/`.
3. Faça o push para `main` e baixe o AAB em Actions.

## Ponte JavaScript (`window.MJAndroid`)

- `buyPremium(accountId?)`: abre a compra da assinatura `premium`
- `playPremium()` / `playPremiumToken()`: assinatura ativa na Play (JSON / token) ou `""`
- `premiumPrice()`: preço como a Play mostra (ex.: "R$ 19,90")
- `refreshPremium()`: consulta de novo as assinaturas
- Avisos para a página: `window.mjPremiumChanged(info)` depois de uma compra e `window.mjPlayTokenReady(info)` ao encontrar uma assinatura ativa
- Também: `setFullscreen`, `copyText`, `shareFile`, `printHtml`
