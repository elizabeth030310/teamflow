package com.teamflow.backend.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class ProductionDatabaseConfigurationTests {
    @Test
    void productionUsesExplicitCredentialsAndVerifiesServerIdentityWithoutSchemaUpdates() {
        try (GenericApplicationContext context = new GenericApplicationContext()) {
            ConfigurableEnvironment environment = loadProduction(context, Map.of(
                    "TEAMFLOW_PROD_DB_HOST", "database.example.test",
                    "TEAMFLOW_PROD_DB_NAME", "teamflow_fixture",
                    "TEAMFLOW_PROD_DB_USER", "application_fixture",
                    "TEAMFLOW_PROD_DB_PASSWORD", "fixture-only",
                    "TEAMFLOW_PROD_DB_SSL_ROOT_CERT", "/certificates/root.crt",
                    "TEAMFLOW_ATTACHMENT_STORAGE_ROOT", "/storage/attachments"));

            assertThat(environment.getRequiredProperty("spring.datasource.url"))
                    .isEqualTo("jdbc:postgresql://database.example.test:5432/teamflow_fixture?sslmode=verify-full");
            assertThat(environment.getRequiredProperty("spring.datasource.username")).isEqualTo("application_fixture");
            assertThat(environment.getRequiredProperty("spring.datasource.password")).isEqualTo("fixture-only");
            assertThat(environment.getRequiredProperty("spring.datasource.hikari.data-source-properties.sslrootcert"))
                    .isEqualTo("/certificates/root.crt");
            assertThat(environment.getRequiredProperty("spring.jpa.hibernate.ddl-auto")).isEqualTo("validate");
            assertThat(environment.getRequiredProperty("spring.sql.init.mode")).isEqualTo("never");
            assertThat(environment.getRequiredProperty("server.servlet.session.cookie.secure")).isEqualTo("true");
        }
    }

    @Test
    void productionDoesNotFallBackToLocalDatabaseSettings() {
        try (GenericApplicationContext context = new GenericApplicationContext()) {
            ConfigurableEnvironment environment = loadProduction(context, Map.of());
            assertThatIllegalArgumentException().isThrownBy(() -> environment.getRequiredProperty("spring.datasource.url"));
            assertThatIllegalArgumentException().isThrownBy(() -> environment.getRequiredProperty("spring.datasource.username"));
            assertThatIllegalArgumentException().isThrownBy(() -> environment.getRequiredProperty("spring.datasource.password"));
        }
    }

    private static ConfigurableEnvironment loadProduction(GenericApplicationContext context, Map<String, Object> values) {
        ConfigurableEnvironment environment = context.getEnvironment();
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().addFirst(new MapPropertySource("settings", values));
        environment.setActiveProfiles("prod");
        new ConfigDataApplicationContextInitializer().initialize(context);
        return environment;
    }
}
