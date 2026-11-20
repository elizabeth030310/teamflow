package com.teamflow.backend;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.util.regex.Pattern;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@SpringBootTest(classes = {BackendApplication.class, IsolatedSpringBootTest.DatabaseConfig.class}, properties = {
        "spring.jpa.hibernate.ddl-auto=update",
        "spring.jpa.defer-datasource-initialization=true",
        "spring.sql.init.mode=always",
        "spring.sql.init.schema-locations=file:db/187-2-notifications.sql,file:db/189-a3-signup-verification.sql,file:db/191-a-task-comment-replies.sql,file:db/191-c-comment-reply-notifications.sql,file:db/192-a-8-user-role.sql,classpath:member-management-test-schema.sql,classpath:admin-test-account.sql",
        "teamflow.attachments.storage-root=",
        "teamflow.signup.hmac-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        "spring.mail.host=",
        "spring.mail.test-connection=false"
})
@interface IsolatedSpringBootTest {
    @TestConfiguration(proxyBeanMethods = false)
    class DatabaseConfig {
        private static final Pattern TEST_URL =
                Pattern.compile("jdbc:postgresql://127\\.0\\.0\\.1:([1-9][0-9]{3,4})/teamflow_test_[0-9a-f]{32}");

        @Bean
        HikariDataSource dataSource() {
            String url = System.getenv("TEAMFLOW_TEST_DB_URL");
            String password = System.getenv("TEAMFLOW_TEST_DB_PASSWORD");
            validateConnection(url, password);

            HikariDataSource dataSource = new HikariDataSource();
            dataSource.setJdbcUrl(url);
            dataSource.setUsername("teamflow_test");
            dataSource.setPassword(password);
            return dataSource;
        }

        static void validateConnection(String url, String password) {
            var endpoint = TEST_URL.matcher(url == null ? "" : url);
            if (!endpoint.matches() || password == null || !password.matches("[0-9a-f]{32}")) {
                throw new IllegalStateException("Run backend/test-isolated.ps1 to start the isolated test database.");
            }

            int port = Integer.parseInt(endpoint.group(1));
            if (port < 1024 || port > 65535 || port == 5432 || port == 5433) {
                throw new IllegalStateException("The isolated test database requires a separate local port.");
            }
        }
    }
}
