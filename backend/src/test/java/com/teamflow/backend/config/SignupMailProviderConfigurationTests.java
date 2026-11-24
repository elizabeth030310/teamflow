package com.teamflow.backend.config;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SignupMailProviderConfigurationTests {
    @ParameterizedTest
    @CsvSource({"default,,smtp", "prod,,brevo", "prod,smtp,smtp", "default,brevo,brevo"})
    void resolvesTheProfileDefaultAndExplicitOverride(String profile, String override, String expected) {
        try (var context = new GenericApplicationContext()) {
            var environment = context.getEnvironment();
            environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
            environment.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
            if (override != null) {
                environment.getPropertySources().addFirst(new MapPropertySource(
                        "settings", Map.of("TEAMFLOW_MAIL_PROVIDER", override)));
            }
            environment.setActiveProfiles(profile);
            new ConfigDataApplicationContextInitializer().initialize(context);
            assertThat(environment.getRequiredProperty("teamflow.signup.mail-provider")).isEqualTo(expected);
        }
    }
}
