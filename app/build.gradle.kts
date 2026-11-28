plugins {
    id("com.android.application")
}

// Senha e caminho da chave de upload vêm de variáveis de ambiente (segredos do GitHub Actions).
val ksFile = System.getenv("UPLOAD_KEYSTORE_FILE")
val ksPass = System.getenv("UPLOAD_KEYSTORE_PASSWORD")

android {
    namespace = "app.mahjuris"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.mahjuris"
        minSdk = 24
        targetSdk = 36
        versionCode = 12
        versionName = "2.0"
    }

    signingConfigs {
        if (ksFile != null && ksPass != null) {
            create("upload") {
                storeFile = file(ksFile)
                storePassword = ksPass
                keyAlias = "upload"
                keyPassword = ksPass
                storeType = "pkcs12"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (ksFile != null && ksPass != null) signingConfig = signingConfigs.getByName("upload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    androidResources {
        // fontes .woff2 já são compactadas
        noCompress += listOf("woff2")
    }
}

dependencies {
    implementation("com.android.billingclient:billing:8.0.0")
}
