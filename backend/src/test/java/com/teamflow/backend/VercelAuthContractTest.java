package com.teamflow.backend;

import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.SignupCodeMailer;
import org.mockito.ArgumentCaptor;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

@IsolatedSpringBootTest
class VercelAuthContractTest {
    @Autowired private WebApplicationContext context;
    @Autowired private UserRepository users;
    @Autowired private PasswordEncoder passwords;
    @Autowired private JdbcTemplate jdbc;
    @MockitoBean private SignupCodeMailer mailer;
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void nodeAuthMatchesSpringAgainstTheSameIsolatedDatabase() throws Exception {
        var mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        String email = UUID.randomUUID() + "@example.test";
        String password = "한".repeat(24);
        User account = users.save(new User("Comparison member", email, passwords.encode(password)));
        String previousAdminHash = jdbc.queryForObject("SELECT password FROM users WHERE id = 3", String.class);
        String admin = "admin-fixture@example.test";
        String adminPassword = UUID.randomUUID().toString();
        String springCodeEmail = UUID.randomUUID() + "@example.test";
        String nodeSignupEmail = UUID.randomUUID() + "@example.test";
        var contracts = new LinkedHashMap<String, Object>();
        try {
            var adminEncoder = new BCryptPasswordEncoder(BCryptPasswordEncoder.BCryptVersion.$2Y);
            jdbc.update("UPDATE users SET password = ? WHERE id = 3", adminEncoder.encode(adminPassword));
            var adminLogin = mvc.perform(login(admin, adminPassword)).andReturn();
            record(contracts, "adminLogin", adminLogin);
            var adminSession = (MockHttpSession) adminLogin.getRequest().getSession(false);
            record(contracts, "anonymous", mvc.perform(get("/api/auth/me")).andReturn());
            record(contracts, "missingHeader", mvc.perform(post("/api/auth/logout")).andReturn());
            record(contracts, "foreignOrigin", mvc.perform(post("/api/auth/logout").header("X-TeamFlow-Request", "1")
                    .header("Origin", "https://other.example.test")).andReturn());
            record(contracts, "invalid", mvc.perform(login(email, "")).andReturn());
            record(contracts, "wrong", mvc.perform(login(email, "wrong-password")).andReturn());
            record(contracts, "unknown", mvc.perform(login("missing@example.test", password)).andReturn());
            record(contracts, "long", mvc.perform(login(email, password + "a")).andReturn());

            var loggedIn = mvc.perform(login(" " + email.toUpperCase(Locale.ROOT) + " ", password)).andReturn();
            record(contracts, "memberLogin", loggedIn);
            var session = (MockHttpSession) loggedIn.getRequest().getSession(false);
            assertThat(session).isNotNull();
            record(contracts, "me", mvc.perform(get("/api/auth/me").session(session)).andReturn());
            record(contracts, "logout", mvc.perform(post("/api/auth/logout")
                    .header("X-TeamFlow-Request", "1").session(session)).andReturn());
            assertThat(session.isInvalid()).isTrue();

            var active = (MockHttpSession) mvc.perform(login(email, password)).andReturn().getRequest().getSession(false);
            jdbc.update("UPDATE users SET account_status = 'SUSPENDED', access_revision = access_revision + 1 WHERE id = ?", account.getId());
            record(contracts, "suspendedLogin", mvc.perform(login(email, password)).andReturn());
            record(contracts, "revoked", mvc.perform(get("/api/auth/me").session(active)).andReturn());
            jdbc.update("UPDATE users SET account_status = 'WITHDRAWN', access_revision = access_revision + 1 WHERE id = ?", account.getId());
            record(contracts, "withdrawnLogin", mvc.perform(login(email, password)).andReturn());
            jdbc.update("UPDATE users SET account_status = 'ACTIVE', access_revision = access_revision + 1 WHERE id = ?", account.getId());

            record(contracts, "signupCode", mvc.perform(write("/api/auth/signup/code", Map.of("email", springCodeEmail))).andReturn());
            var delivered = ArgumentCaptor.forClass(String.class);
            verify(mailer, timeout(3_000)).send(eq(springCodeEmail), delivered.capture());
            record(contracts, "signupInvalid", mvc.perform(write("/api/auth/signup",
                    Map.of("email", springCodeEmail, "name", "", "password", password, "code", delivered.getValue()))).andReturn());
            record(contracts, "memberStats", mvc.perform(get("/api/admin/users/stats").session(adminSession)).andReturn());
            var springMember = (MockHttpSession) mvc.perform(login(email, password)).andReturn().getRequest().getSession(false);
            record(contracts, "memberForbidden", mvc.perform(get("/api/admin/users").session(springMember)).andReturn());
            long revision = jdbc.queryForObject("SELECT access_revision FROM users WHERE id = ?", Long.class, account.getId());
            String originalHash = jdbc.queryForObject("SELECT password FROM users WHERE id = ?", String.class, account.getId());
            var change = Map.of("status", "SUSPENDED", "revision", revision, "reason", "Comparison");
            record(contracts, "statusChange", mvc.perform(write("/api/admin/users/" + account.getId() + "/status", change)
                    .header("X-TeamFlow-Admin", "member-status").session(adminSession)).andReturn());
            record(contracts, "statusRetry", mvc.perform(write("/api/admin/users/" + account.getId() + "/status", change)
                    .header("X-TeamFlow-Admin", "member-status").session(adminSession)).andReturn());
            jdbc.update("DELETE FROM admin_member_audit WHERE target_id = ?", account.getId());
            jdbc.update("UPDATE users SET account_status = 'ACTIVE', access_revision = ? WHERE id = ?", revision, account.getId());
            record(contracts, "passwordChange", mvc.perform(write("/api/auth/change-password",
                    Map.of("currentPassword", password, "newPassword", "replacement-password")).session(springMember)).andReturn());
            assertThat(springMember.isInvalid()).isTrue();
            jdbc.update("UPDATE users SET password = ?, access_revision = ? WHERE id = ?", originalHash, revision, account.getId());

            var process = new ProcessBuilder("node", "integration/compare-spring.mjs")
                    .directory(Path.of("..", "deploy", "vercel", "functions").toFile())
                    .redirectErrorStream(true).start();
            try {
                try (var input = process.getOutputStream()) {
                    json.writeValue(input, Map.of("email", email, "password", password, "admin", admin,
                            "adminPassword", adminPassword, "id", account.getId(), "contracts", contracts,
                            "springCodeEmail", springCodeEmail, "springCode", delivered.getValue(),
                            "nodeSignupEmail", nodeSignupEmail));
                }
                assertThat(process.waitFor(65, TimeUnit.SECONDS)).isTrue();
                String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                assertThat(process.exitValue()).withFailMessage("Node comparison failed:%n%s", output).isZero();
                String newHash = jdbc.queryForObject("SELECT password FROM users WHERE email = ?", String.class, nodeSignupEmail);
                assertThat(passwords.matches("replacement-password", newHash)).isTrue();
            } finally {
                if (process.isAlive()) process.destroyForcibly();
            }
        } finally {
            jdbc.update("UPDATE users SET password = ? WHERE id = 3", previousAdminHash);
            jdbc.update("DELETE FROM admin_member_audit WHERE target_id = ?", account.getId());
            jdbc.update("DELETE FROM users WHERE email IN (?, ?)", springCodeEmail, nodeSignupEmail);
            users.deleteById(account.getId());
        }
    }

    private MockHttpServletRequestBuilder login(String email, String password) {
        return write("/api/auth/login", Map.of("email", email, "password", password));
    }

    private MockHttpServletRequestBuilder write(String path, Map<String, ?> payload) {
        return post(path).header("X-TeamFlow-Request", "1")
                .with(request -> {
                    request.setRemoteAddr("192.0.2.151");
                    return request;
                })
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(payload));
    }

    private void record(Map<String, Object> contracts, String name, MvcResult result) throws Exception {
        int status = result.getResponse().getStatus();
        var contract = new LinkedHashMap<String, Object>();
        contract.put("status", status);
        if ((status >= 200 && status < 204) || status == 400) {
            contract.put("body", json.readTree(result.getResponse().getContentAsByteArray()));
        }
        contracts.put(name, contract);
    }
}
