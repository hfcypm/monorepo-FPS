plugins {
    id("com.android.library") version "8.6.1"
    kotlin("android") version "2.0.21"
    `maven-publish`
}

android {
    namespace = "com.example.performance"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

dependencies {
    implementation("androidx.metrics:metrics-performance:1.0.0")
}

afterEvaluate {
    publishing {
        publications {
            register<MavenPublication>("release") {
                from(components["release"])
                groupId = providers.gradleProperty("GROUP").get()
                artifactId = "android-performance-sdk"
                version = providers.gradleProperty("VERSION_NAME").get()

                pom {
                    name.set(providers.gradleProperty("POM_NAME"))
                    description.set(providers.gradleProperty("POM_DESCRIPTION"))
                }
            }
        }
        repositories {
            maven {
                name = "localRelease"
                url = layout.buildDirectory.dir("repo").get().asFile.toURI()
            }
        }
    }
}
