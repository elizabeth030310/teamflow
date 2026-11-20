package com.teamflow.backend;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

class IsolatedDatabaseConnectionTests {
    private static final String LAUNCHER_PASSWORD = "00000000000000000000000000000000";
    private static final String DATABASE = "teamflow_test_0123456789abcdef0123456789abcdef";
    private static final String LAUNCHER_URL = "jdbc:postgresql://127.0.0.1:49152/" + DATABASE;

    @Test
    void acceptsLauncherEndpoint() {
        assertThatCode(() -> validate(LAUNCHER_URL, LAUNCHER_PASSWORD))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectsMissingSettingsAndNonIsolatedEndpoints() {
        assertThatIllegalStateException().isThrownBy(() -> validate(null, LAUNCHER_PASSWORD));
        assertThatIllegalStateException().isThrownBy(() -> validate(LAUNCHER_URL, null));
        for (String url : java.util.List.of(
                "jdbc:postgresql://localhost:5433/teamflow",
                "jdbc:postgresql://127.0.0.1:5432/" + DATABASE,
                "jdbc:postgresql://127.0.0.1:5433/" + DATABASE,
                "jdbc:postgresql://127.0.0.1:49152/teamflow_test",
                "jdbc:postgresql://127.0.0.1:49152/teamflow",
                "jdbc:postgresql://192.0.2.1:49152/" + DATABASE,
                LAUNCHER_URL + "?user=teamflow")) {
            assertThatIllegalStateException().isThrownBy(() -> validate(url, LAUNCHER_PASSWORD));
        }
    }

    private static void validate(String url, String password) {
        IsolatedSpringBootTest.DatabaseConfig.validateConnection(url, password);
    }
}
