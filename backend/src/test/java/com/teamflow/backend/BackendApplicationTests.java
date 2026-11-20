package com.teamflow.backend;

import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.SignupCodeMailer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.server.ResponseStatusException;
import org.mockito.ArgumentCaptor;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@IsolatedSpringBootTest
class BackendApplicationTests {
	@Autowired
	private WebApplicationContext context;
	@Autowired private JdbcTemplate jdbc;
	@Autowired private DataSource dataSource;
	@Autowired private UserRepository users;
	@Autowired private PasswordEncoder passwords;
	@MockitoBean private SignupCodeMailer mailer;

	@Test
	void contextLoads() {
	}

	@Test
	void adminSummaryUsesTheCurrentDatabaseRole() throws Exception {
		MockMvc mvc = mvc();
		String email = newEmail();
		String password = "example-password";
		User account = users.save(new User("Account", email, passwords.encode(password)));
		String summary = "/api/admin/summary";

		mvc.perform(get(summary)).andExpect(status().isUnauthorized());
		MockHttpSession userSession = (MockHttpSession) login(mvc, email, password)
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.role").value("USER"))
				.andReturn().getRequest().getSession(false);
		mvc.perform(get(summary).session(userSession)).andExpect(status().isForbidden());

		jdbc.update("UPDATE users SET role = 'ADMIN' WHERE id = ?", account.getId());
		new ResourceDatabasePopulator(new FileSystemResource("db/192-a-8-user-role.sql")).execute(dataSource);
		MockHttpSession adminSession = (MockHttpSession) login(mvc, email, password)
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.role").value("ADMIN"))
				.andExpect(jsonPath("$.password").doesNotHaveJsonPath())
				.andReturn().getRequest().getSession(false);
		mvc.perform(get("/api/auth/me").session(adminSession))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.role").value("ADMIN"));
		mvc.perform(get(summary).session(adminSession))
				.andExpect(status().isOk())
				.andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
				.andExpect(jsonPath("$.userCount").value(users.count()))
				.andExpect(jsonPath("$.email").doesNotHaveJsonPath())
				.andExpect(jsonPath("$.password").doesNotHaveJsonPath());

		jdbc.update("UPDATE users SET role = 'USER' WHERE id = ?", account.getId());
		mvc.perform(get(summary).session(adminSession)).andExpect(status().isForbidden());
	}

	@Test
	void signupAndLoginIgnoreRoleSuppliedInRequestBodies() throws Exception {
		MockMvc mvc = mvc();
		String email = newEmail();
		String password = "example-password";
		requestCode(mvc, email).andExpect(status().isAccepted());
		mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON).content("""
				{"name":"Account","email":"%s","password":"%s","code":"%s","role":"ADMIN"}
				""".formatted(email, password, deliveredCode(email, 1))))
				.andExpect(status().isCreated());
		assertThat(users.findByEmail(email).orElseThrow().getRole()).isEqualTo(User.Role.USER);

		MockHttpSession session = (MockHttpSession) mvc.perform(post("/api/auth/login")
				.contentType(MediaType.APPLICATION_JSON).content("""
						{"email":"%s","password":"%s","role":"ADMIN"}
						""".formatted(email, password)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.role").value("USER"))
				.andReturn().getRequest().getSession(false);
		mvc.perform(get("/api/admin/summary").session(session)).andExpect(status().isForbidden());
	}

	@Test
	void authenticationHandlesTheBcryptByteLimitAndSessionLifecycle() throws Exception {
		MockMvc mvc = mvc();
		String email = newEmail();
		String password = "가".repeat(24);
		String login = """
				{"email":"%s","password":"%s"}
				""";

		complete(mvc, email, password, "000000").andExpect(status().isUnprocessableContent());
		requestCode(mvc, email).andExpect(status().isAccepted()).andExpect(jsonPath("$.code").doesNotHaveJsonPath());
		String code = deliveredCode(email, 1);
		assertThat(code).matches("[0-9]{6}");
		assertThat(jdbc.queryForObject("SELECT octet_length(code_mac) FROM signup_verifications WHERE email_key = ?",
				Integer.class, emailKey(email))).isEqualTo(32);
		assertThat(users.existsByEmail(email)).isFalse();
		mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
						.content(login.formatted(email, password))).andExpect(status().isUnauthorized());
		complete(mvc, email, password + "a", code).andExpect(status().isBadRequest());
		complete(mvc, email, password, "").andExpect(status().isBadRequest());
		complete(mvc, email, password, code).andExpect(status().isCreated())
				.andExpect(jsonPath("$.password").doesNotHaveJsonPath());
		complete(mvc, email, password, code).andExpect(status().isUnprocessableContent());
		mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
						.content(login.formatted(email, password + "a")))
				.andExpect(status().isUnauthorized());
		mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());

		MockHttpSession session = (MockHttpSession) mvc.perform(post("/api/auth/login")
						.contentType(MediaType.APPLICATION_JSON).content(login.formatted(email, password)))
				.andExpect(status().isOk())
				.andReturn().getRequest().getSession(false);
		mvc.perform(get("/api/auth/me").session(session))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.email").value(email));
		mvc.perform(get("/api/projects").session(session)).andExpect(status().isOk());
		mvc.perform(post("/api/auth/logout").session(session)).andExpect(status().isOk());
		org.junit.jupiter.api.Assertions.assertTrue(session.isInvalid());
	}

	@Test
	void changingPasswordRequiresLogin() throws Exception {
		mvc().perform(post("/api/auth/change-password").contentType(MediaType.APPLICATION_JSON)
				.content(passwordChange("old-password", "new-password")))
				.andExpect(status().isUnauthorized());
	}

	@Test
	void changingPasswordUpdatesOnlyThePasswordAndEndsTheSession() throws Exception {
		MockMvc mvc = mvc();
		String email = newEmail();
		String currentPassword = "old-password";
		String newPassword = "\uAC00".repeat(24);
		User account = users.save(new User("Existing", email, passwords.encode(currentPassword)));
		MockHttpSession session = (MockHttpSession) login(mvc, email, currentPassword)
				.andExpect(status().isOk()).andReturn().getRequest().getSession(false);

		mvc.perform(post("/api/auth/change-password").session(session).contentType(MediaType.APPLICATION_JSON)
				.content(passwordChange(currentPassword, newPassword)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.message").exists());

		assertThat(session.isInvalid()).isTrue();
		User updated = users.findById(account.getId()).orElseThrow();
		assertThat(updated.getName()).isEqualTo(account.getName());
		assertThat(updated.getEmail()).isEqualTo(email);
		assertThat(passwords.matches(newPassword, updated.getPassword())).isTrue();
		login(mvc, email, currentPassword).andExpect(status().isUnauthorized());
		MockHttpSession newSession = (MockHttpSession) login(mvc, email, newPassword)
				.andExpect(status().isOk()).andReturn().getRequest().getSession(false);
		mvc.perform(get("/api/projects").session(newSession)).andExpect(status().isOk());
	}

	@Test
	void rejectedPasswordChangesKeepThePasswordAndSession() throws Exception {
		MockMvc mvc = mvc();
		String email = newEmail();
		String currentPassword = "old-password";
		User account = users.save(new User("Existing", email, passwords.encode(currentPassword)));
		MockHttpSession session = (MockHttpSession) login(mvc, email, currentPassword)
				.andExpect(status().isOk()).andReturn().getRequest().getSession(false);

		for (String invalidBody : List.of(
				passwordChange("wrong-password", "new-password"),
				passwordChange("\uAC00".repeat(25), "new-password"),
				passwordChange(currentPassword, "short"),
				passwordChange(currentPassword, "\uD83D\uDE00".repeat(7)),
				passwordChange(currentPassword, "\uAC00".repeat(24) + "a"),
				passwordChange(currentPassword, " ".repeat(8)),
				"{\"newPassword\":\"new-password\"}",
				"{")) {
			mvc.perform(post("/api/auth/change-password").session(session).contentType(MediaType.APPLICATION_JSON)
					.content(invalidBody)).andExpect(status().isBadRequest());
		}

		assertThat(passwords.matches(currentPassword,
				users.findById(account.getId()).orElseThrow().getPassword())).isTrue();
		mvc.perform(get("/api/auth/me").session(session)).andExpect(status().isOk());
	}

	private static String passwordChange(String currentPassword, String newPassword) {
		return """
				{"currentPassword":"%s","newPassword":"%s"}
				""".formatted(currentPassword, newPassword);
	}

	private static ResultActions login(MockMvc mvc, String email, String password) throws Exception {
		return mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"email":"%s","password":"%s"}
						""".formatted(email, password)));
	}

	@Test
	void resendCooldownExpiryAndAttemptLimitInvalidateCodes() throws Exception {
		MockMvc mvc = mvc();
		String email = newEmail();
		requestCode(mvc, email).andExpect(status().isAccepted());
		String first = deliveredCode(email, 1);
		requestCode(mvc, email).andExpect(status().isTooManyRequests())
				.andExpect(header().exists(HttpHeaders.RETRY_AFTER));
		String key = emailKey(email);
		openResendWindow(key);
		requestCode(mvc, email).andExpect(status().isAccepted());
		String second = deliveredCode(email, 2);
		assertThat(second).isNotEqualTo(first);
		for (int attempt = 0; attempt < 5; attempt++) {
			complete(mvc, email, "password123", first).andExpect(status().isUnprocessableContent());
		}
		complete(mvc, email, "password123", second).andExpect(status().isUnprocessableContent());
		openResendWindow(key);
		requestCode(mvc, email).andExpect(status().isAccepted());
		String third = deliveredCode(email, 3);
		jdbc.update("UPDATE signup_verifications SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE email_key = ?", key);
		complete(mvc, email, "password123", third).andExpect(status().isUnprocessableContent());
		for (int send = 0; send < 2; send++) {
			openResendWindow(key);
			requestCode(mvc, email).andExpect(status().isAccepted());
		}
		openResendWindow(key);
		requestCode(mvc, email).andExpect(status().isTooManyRequests());
		assertThat(users.existsByEmail(email)).isFalse();
	}

	@Test
	void concurrentCompletionsCreateOnlyOneAccount() throws Exception {
		MockMvc mvc = mvc();
		String email = newEmail();
		requestCode(mvc, email).andExpect(status().isAccepted());
		String code = deliveredCode(email, 1);
		try (var executor = Executors.newFixedThreadPool(2)) {
			var first = executor.submit(() -> complete(mvc, email, "password123", code).andReturn().getResponse().getStatus());
			var second = executor.submit(() -> complete(mvc, email, "password123", code).andReturn().getResponse().getStatus());
			assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS)))
					.containsExactlyInAnyOrder(201, 422);
		}
	}

	@Test
	void existingAccountCanLogInAndReceivesTheSameSignupResponseWithoutMail() throws Exception {
		MockMvc mvc = mvc();
		String email = newEmail();
		users.save(new User("Existing", email, passwords.encode("password123")));
		requestCode(mvc, email).andExpect(status().isAccepted())
				.andExpect(jsonPath("$.resendAfterSeconds").value(60));
		verify(mailer).requireAvailable();
		org.mockito.Mockito.verifyNoMoreInteractions(mailer);
		mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"email":"%s","password":"password123"}
						""".formatted(email))).andExpect(status().isOk());
	}

	@Test
	void oneAddressCannotSendToUnlimitedMailboxes() throws Exception {
		MockMvc mvc = mvc();
		for (int send = 0; send < 20; send++) {
			requestCode(mvc, newEmail(), "192.0.2.44").andExpect(status().isAccepted());
		}
		requestCode(mvc, newEmail(), "192.0.2.44").andExpect(status().isTooManyRequests())
				.andExpect(header().exists(HttpHeaders.RETRY_AFTER));
	}

	@Test
	void mailFailureKeepsTheCooldownWithoutCreatingAnAccount() throws Exception {
		MockMvc mvc = mvc();
		String email = newEmail();
		doThrow(new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE))
				.when(mailer).send(eq(email), anyString());
		requestCode(mvc, email).andExpect(status().isServiceUnavailable());
		requestCode(mvc, email).andExpect(status().isTooManyRequests());
		assertThat(users.existsByEmail(email)).isFalse();
	}

	private MockMvc mvc() {
		return MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
	}

	private void openResendWindow(String key) {
		assertThat(jdbc.update("""
				UPDATE signup_verifications SET resend_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
				WHERE email_key = ?
				""", key)).isEqualTo(1);
	}

	private static ResultActions requestCode(MockMvc mvc, String email) throws Exception {
		return requestCode(mvc, email, "127.0.0.1");
	}

	private static ResultActions requestCode(MockMvc mvc, String email, String ip) throws Exception {
		return mvc.perform(post("/api/auth/signup/code").contentType(MediaType.APPLICATION_JSON)
				.with(request -> {
					request.setRemoteAddr(ip);
					request.addHeader("X-Forwarded-For", email);
					return request;
				}).content("""
						{"email":"%s"}
						""".formatted(email)));
	}

	private static ResultActions complete(MockMvc mvc, String email, String password, String code) throws Exception {
		return mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"name":"Tester","email":"%s","password":"%s","code":"%s"}
						""".formatted(email, password, code)));
	}

	private String deliveredCode(String email, int deliveries) {
		var argument = ArgumentCaptor.forClass(String.class);
		verify(mailer, times(deliveries)).send(eq(email), argument.capture());
		return argument.getValue();
	}

	private static String emailKey(String email) throws Exception {
		Mac mac = Mac.getInstance("HmacSHA256");
		mac.init(new SecretKeySpec(new byte[32], "HmacSHA256"));
		return HexFormat.of().formatHex(mac.doFinal(("email:" + email).getBytes(StandardCharsets.UTF_8)));
	}

	private static String newEmail() {
		return UUID.randomUUID() + "@example.test";
	}
}
