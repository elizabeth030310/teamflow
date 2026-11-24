package com.teamflow.backend;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.ProjectRepository;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.SignupCodeMailer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.server.ResponseStatusException;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
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
	@Autowired private UserRepository users;
	@Autowired private ProjectRepository projects;
	@Autowired private PasswordEncoder passwords;
	@MockitoBean private SignupCodeMailer mailer;

	@Test
	void contextLoads() {
	}

	@Test
	void stateChangesRequireTheApplicationHeaderAndSameOrigin() throws Exception {
		MockMvc rawMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
		rawMvc.perform(post("/api/auth/logout")).andExpect(status().isForbidden());
		mvc().perform(post("/api/auth/logout").header("Sec-Fetch-Site", "same-site"))
				.andExpect(status().isForbidden());
		mvc().perform(post("/api/auth/logout").header("Origin", "https://example.invalid"))
				.andExpect(status().isForbidden());
		mvc().perform(post("/api/auth/logout").header("Sec-Fetch-Site", "same-origin"))
				.andExpect(status().isOk());
	}

	@Test
	void administratorCanManageMembersAndRevokeExistingSessions() throws Exception {
		MockMvc mvc = mvc();
		String adminEmail = "admin-fixture@example.test";
		String password = "example-password";
		jdbc.update("UPDATE users SET password = ? WHERE id = 3", passwords.encode(password));
		User member = users.save(new User("Member", newEmail(), passwords.encode(password)));
		String list = "/api/admin/users";
		String audit = "/api/admin/audit";
		String auditPage = audit + "/page";
		String stats = list + "/stats";
		String change = list + "/" + member.getId() + "/status";

		mvc.perform(get(list)).andExpect(status().isUnauthorized());
		mvc.perform(get(audit)).andExpect(status().isUnauthorized());
		mvc.perform(get(auditPage)).andExpect(status().isUnauthorized());
		mvc.perform(get(stats)).andExpect(status().isUnauthorized());
		changeMemberStatus(mvc, null, change, "SUSPENDED", 0, "review").andExpect(status().isUnauthorized());
		MockHttpSession memberSession = (MockHttpSession) login(mvc, member.getEmail(), password)
				.andExpect(status().isOk()).andReturn().getRequest().getSession(false);
		mvc.perform(get(list).session(memberSession)).andExpect(status().isForbidden());
		mvc.perform(get(audit).session(memberSession)).andExpect(status().isForbidden());
		mvc.perform(get(auditPage).session(memberSession)).andExpect(status().isForbidden());
		mvc.perform(get(stats).session(memberSession)).andExpect(status().isForbidden());
		changeMemberStatus(mvc, memberSession, change, "SUSPENDED", 0, "review").andExpect(status().isForbidden());
		assertThatThrownBy(() -> jdbc.update("UPDATE users SET role = 'ADMIN' WHERE id = ?", member.getId()))
				.isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> jdbc.update("UPDATE users SET role = 'USER' WHERE id = 3"))
				.isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> jdbc.update("UPDATE users SET email = ? WHERE id = 3", newEmail()))
				.isInstanceOf(DataIntegrityViolationException.class);

		MockHttpSession adminSession = (MockHttpSession) login(mvc, adminEmail, password)
				.andExpect(status().isOk()).andExpect(jsonPath("$.role").value("ADMIN"))
				.andReturn().getRequest().getSession(false);
		mvc.perform(get(list).session(adminSession))
				.andExpect(status().isOk())
				.andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
				.andExpect(jsonPath("$[*].password").isEmpty())
				.andExpect(jsonPath("$[?(@.email == '%s')].status".formatted(member.getEmail())).value("ACTIVE"));
		long activeMembers = jdbc.queryForObject("SELECT count(*) FROM users WHERE role = 'USER'", Long.class);
		expectMemberStats(mvc, adminSession, stats, activeMembers, 0, 0);
		mvc.perform(get(auditPage).session(adminSession))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.entries").isEmpty())
				.andExpect(jsonPath("$.nextCursor").isEmpty());
		changeMemberStatus(mvc, adminSession, list + "/3/status", "SUSPENDED", 0, "review")
				.andExpect(status().isForbidden());
		changeMemberStatus(mvc, adminSession, list + "/2147483647/status", "SUSPENDED", 0, "review")
				.andExpect(status().isNotFound());
		changeMemberStatus(mvc, adminSession, change, "SUSPENDED", 0, " ")
				.andExpect(status().isBadRequest());
		mvc.perform(post(change).session(adminSession).contentType(MediaType.APPLICATION_JSON)
						.content("""
								{"status":"SUSPENDED","revision":0,"reason":"review"}
								"""))
				.andExpect(status().isForbidden());

		try (var executor = Executors.newFixedThreadPool(2)) {
			var first = executor.submit(() -> changeMemberStatus(mvc, adminSession, change, "SUSPENDED", 0, "review")
					.andReturn().getResponse().getStatus());
			var retry = executor.submit(() -> changeMemberStatus(mvc, adminSession, change, "SUSPENDED", 0, "review")
					.andReturn().getResponse().getStatus());
			assertThat(first.get(10, TimeUnit.SECONDS)).isEqualTo(204);
			assertThat(retry.get(10, TimeUnit.SECONDS)).isEqualTo(204);
		}
		assertThat(jdbc.queryForObject("SELECT count(*) FROM admin_member_audit WHERE target_id = ?", Long.class,
				member.getId())).isEqualTo(1L);
		expectMemberStats(mvc, adminSession, stats, activeMembers - 1, 1, 0);
		mvc.perform(get("/api/auth/me").session(memberSession)).andExpect(status().isUnauthorized());
		mvc.perform(get("/api/projects").session(memberSession)).andExpect(status().isUnauthorized());
		login(mvc, member.getEmail(), password).andExpect(status().isUnauthorized());
		requestCode(mvc, member.getEmail(), "192.0.2.45").andExpect(status().isAccepted())
				.andExpect(jsonPath("$.resendAfterSeconds").value(60));
		String suspendedEmailKey = emailKey(member.getEmail());
		assertThat(jdbc.queryForObject("SELECT code_mac FROM signup_verifications WHERE email_key = ?",
				byte[].class, suspendedEmailKey)).isNull();
		complete(mvc, member.getEmail(), password, "000000").andExpect(status().isUnprocessableContent());
		verify(mailer, after(150).never()).send(eq(member.getEmail()), anyString());

		changeMemberStatus(mvc, adminSession, change, "ACTIVE", 1, "resolved").andExpect(status().isNoContent());
		expectMemberStats(mvc, adminSession, stats, activeMembers, 0, 0);
		mvc.perform(get("/api/auth/me").session(memberSession)).andExpect(status().isUnauthorized());
		MockHttpSession restored = (MockHttpSession) login(mvc, member.getEmail(), password)
				.andExpect(status().isOk()).andReturn().getRequest().getSession(false);
		mvc.perform(get("/api/projects").session(restored)).andExpect(status().isOk());
		changeMemberStatus(mvc, adminSession, change, "SUSPENDED", 0, "review").andExpect(status().isConflict());

		Project retainedProject = new Project("Retained project", "Collaboration history");
		retainedProject.setOwner(member);
		long projectId = projects.save(retainedProject).getId();
		User otherOwner = users.findById(3L).orElseThrow();
		Project sharedProject = new Project("Shared project", "Membership history");
		sharedProject.setOwner(otherOwner);
		long sharedId = projects.save(sharedProject).getId();
		jdbc.update("INSERT INTO project_members (project_id, user_id, status) VALUES (?, ?, 'ACCEPTED')",
				sharedId, member.getId());
		Project invitationProject = new Project("Pending invitation", "Invitation history");
		invitationProject.setOwner(otherOwner);
		long invitationProjectId = projects.save(invitationProject).getId();
		jdbc.update("INSERT INTO project_members (project_id, user_id, status) VALUES (?, ?, 'PENDING')",
				invitationProjectId, member.getId());

		changeMemberStatus(mvc, adminSession, change, "WITHDRAWN", 2, "withdrawal").andExpect(status().isNoContent());
		expectMemberStats(mvc, adminSession, stats, activeMembers - 1, 0, 1);
		mvc.perform(get("/api/auth/me").session(restored)).andExpect(status().isUnauthorized());
		login(mvc, member.getEmail(), password).andExpect(status().isUnauthorized());
		changeMemberStatus(mvc, adminSession, change, "ACTIVE", 3, "review").andExpect(status().isConflict());
		assertThat(users.findById(member.getId()).orElseThrow().getAccountStatus()).isEqualTo(User.Status.WITHDRAWN);
		assertThat(projects.findByIdAndOwnerId(projectId, member.getId())).isPresent();
		mvc.perform(get(audit).session(adminSession)).andExpect(status().isOk())
				.andExpect(jsonPath("$[0].actorId").value(3))
				.andExpect(jsonPath("$[0].targetId").value(member.getId()))
				.andExpect(jsonPath("$[0].fromStatus").value("ACTIVE"))
				.andExpect(jsonPath("$[0].toStatus").value("WITHDRAWN"))
				.andExpect(jsonPath("$[0].reason").value("withdrawal"));

		String cursor = String.valueOf(jdbc.queryForObject(
				"SELECT id FROM admin_member_audit WHERE target_id = ? AND to_status = 'ACTIVE'", Long.class, member.getId()));
		mvc.perform(get(auditPage).session(adminSession).param("limit", "1"))
				.andExpect(status().isOk())
				.andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
				.andExpect(jsonPath("$.entries.length()").value(1))
				.andExpect(jsonPath("$.entries[0].toStatus").value("WITHDRAWN"))
				.andExpect(jsonPath("$.entries[0].occurredAt").isString())
				.andExpect(jsonPath("$.entries[0].email").doesNotHaveJsonPath())
				.andExpect(jsonPath("$.nextCursor").value(cursor));
		mvc.perform(get(auditPage).session(adminSession).param("cursor", cursor))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.entries.length()").value(2))
				.andExpect(jsonPath("$.entries[0].toStatus").value("ACTIVE"))
				.andExpect(jsonPath("$.entries[1].toStatus").value("SUSPENDED"))
				.andExpect(jsonPath("$.nextCursor").isEmpty());
		mvc.perform(get(auditPage).session(adminSession).param("toStatus", "SUSPENDED"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.entries.length()").value(1))
				.andExpect(jsonPath("$.entries[0].toStatus").value("SUSPENDED"));
		mvc.perform(get(auditPage).session(adminSession).param("limit", "101")).andExpect(status().isBadRequest());
		mvc.perform(get(auditPage).session(adminSession).param("cursor", "0")).andExpect(status().isBadRequest());
		mvc.perform(get(auditPage).session(adminSession).param("toStatus", "UNKNOWN")).andExpect(status().isBadRequest());

		openResendWindow(suspendedEmailKey);
		String email = member.getEmail();
		String caseVariant = email.toUpperCase(java.util.Locale.ROOT);
		requestCode(mvc, caseVariant, "192.0.2.45").andExpect(status().isAccepted())
				.andExpect(jsonPath("$.resendAfterSeconds").value(60));
		String code = deliveredCode(email, 1);
		String newPassword = "different-password";
		try (var executor = Executors.newFixedThreadPool(2)) {
			var first = executor.submit(() -> complete(mvc, caseVariant, newPassword, code)
					.andReturn().getResponse().getStatus());
			var second = executor.submit(() -> complete(mvc, email, newPassword, code)
					.andReturn().getResponse().getStatus());
			assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS)))
					.containsExactlyInAnyOrder(201, 422);
		}

		User replacement = users.findByEmail(email).orElseThrow();
		assertThat(replacement.getId()).isNotEqualTo(member.getId());
		assertThat(replacement.getRole()).isEqualTo(User.Role.USER);
		assertThat(replacement.getAccountStatus()).isEqualTo(User.Status.ACTIVE);
		assertThat(replacement.getAccessRevision()).isZero();
		assertThat(jdbc.queryForObject("SELECT count(*) FROM users WHERE lower(email) = lower(?)",
				Long.class, email)).isEqualTo(2L);
		User historical = users.findById(member.getId()).orElseThrow();
		assertThat(historical.getEmail()).isEqualTo(email);
		assertThat(historical.getAccountStatus()).isEqualTo(User.Status.WITHDRAWN);
		assertThat(historical.getAccessRevision()).isEqualTo(3L);
		assertThatThrownBy(() -> users.saveAndFlush(new User("Duplicate", caseVariant, historical.getPassword())))
				.isInstanceOf(DataIntegrityViolationException.class);

		login(mvc, email, password).andExpect(status().isUnauthorized());
		MockHttpSession replacementSession = (MockHttpSession) login(mvc, caseVariant, newPassword)
				.andExpect(status().isOk()).andExpect(jsonPath("$.id").value(replacement.getId()))
				.andReturn().getRequest().getSession(false);
		mvc.perform(get("/api/projects").session(restored)).andExpect(status().isUnauthorized());
		mvc.perform(get("/api/projects").session(replacementSession)).andExpect(status().isOk())
				.andExpect(jsonPath("$.length()").value(0));
		mvc.perform(get("/api/projects/invitations").session(replacementSession)).andExpect(status().isOk())
				.andExpect(jsonPath("$.length()").value(0));
		mvc.perform(get("/api/projects/{id}/invitations", invitationProjectId).session(adminSession))
				.andExpect(status().isOk()).andExpect(jsonPath("$[0].userId").value(member.getId()))
				.andExpect(jsonPath("$[0].email").value(""));
		mvc.perform(post("/api/projects/{id}/invitations", invitationProjectId).session(adminSession)
				.contentType(MediaType.APPLICATION_JSON).content("""
						{"email":"%s"}
						""".formatted(email)))
				.andExpect(status().isCreated()).andExpect(jsonPath("$.userId").value(replacement.getId()));
		assertThat(projects.findByIdAndOwnerId(projectId, member.getId())).isPresent();
		assertThat(jdbc.queryForObject("""
				SELECT count(*) FROM project_members WHERE project_id = ? AND user_id = ? AND status = 'ACCEPTED'
				""", Long.class, sharedId, member.getId())).isEqualTo(1L);

		try {
			jdbc.update("UPDATE users SET account_status = 'SUSPENDED', access_revision = 1 WHERE id = 3");
			mvc.perform(get(audit).session(adminSession)).andExpect(status().isUnauthorized());
			mvc.perform(get(auditPage).session(adminSession)).andExpect(status().isUnauthorized());
			mvc.perform(get(stats).session(adminSession)).andExpect(status().isUnauthorized());
			login(mvc, adminEmail, password).andExpect(status().isUnauthorized());
		} finally {
			jdbc.update("UPDATE users SET account_status = 'ACTIVE', access_revision = 2 WHERE id = 3");
		}
	}

	private void expectMemberStats(MockMvc mvc, MockHttpSession session, String path,
								   long active, long suspended, long withdrawn) throws Exception {
		mvc.perform(get(path).session(session))
				.andExpect(status().isOk())
				.andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
				.andExpect(jsonPath("$.total").value((int) (active + suspended + withdrawn)))
				.andExpect(jsonPath("$.active").value((int) active))
				.andExpect(jsonPath("$.suspended").value((int) suspended))
				.andExpect(jsonPath("$.withdrawn").value((int) withdrawn));
	}

	private ResultActions changeMemberStatus(MockMvc mvc, MockHttpSession session, String path,
											 String status, long revision, String reason) throws Exception {
		var request = post(path).contentType(MediaType.APPLICATION_JSON).header("X-TeamFlow-Admin", "member-status")
				.content("""
						{"status":"%s","revision":%s,"reason":"%s"}
						""".formatted(status, revision, reason));
		return mvc.perform(session == null ? request : request.session(session));
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
		mvc.perform(get("/api/admin/users").session(session)).andExpect(status().isForbidden());
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
	void changingPasswordUpdatesCredentialsAndRevokesAllSessions() throws Exception {
		MockMvc mvc = mvc();
		String email = newEmail();
		String currentPassword = "old-password";
		String newPassword = "\uAC00".repeat(24);
		User account = users.save(new User("Existing", email, passwords.encode(currentPassword)));
		MockHttpSession session = (MockHttpSession) login(mvc, email, currentPassword)
				.andExpect(status().isOk()).andReturn().getRequest().getSession(false);
		MockHttpSession otherSession = (MockHttpSession) login(mvc, email, currentPassword)
				.andExpect(status().isOk()).andReturn().getRequest().getSession(false);
		mvc.perform(get("/api/projects").session(otherSession)).andExpect(status().isOk());

		mvc.perform(post("/api/auth/change-password").session(session).contentType(MediaType.APPLICATION_JSON)
				.content(passwordChange(currentPassword, newPassword)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.message").exists());

		assertThat(session.isInvalid()).isTrue();
		mvc.perform(get("/api/projects").session(otherSession)).andExpect(status().isUnauthorized());
		User updated = users.findById(account.getId()).orElseThrow();
		assertThat(updated.getAccessRevision()).isEqualTo(account.getAccessRevision() + 1);
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
		verify(mailer, never()).send(eq(email), anyString());
		assertThat(jdbc.queryForObject("SELECT code_mac FROM signup_verifications WHERE email_key = ?",
				byte[].class, emailKey(email))).isNull();
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
		requestCode(mvc, email).andExpect(status().isAccepted());
		verify(mailer, timeout(3000)).send(eq(email), anyString());
		requestCode(mvc, email).andExpect(status().isTooManyRequests());
		assertThat(users.existsByEmail(email)).isFalse();
	}

	private MockMvc mvc() {
		return MockMvcBuilders.webAppContextSetup(context).apply(springSecurity())
				.defaultRequest(get("/").header("X-TeamFlow-Request", "1")).build();
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
		verify(mailer, timeout(3000).times(deliveries)).send(eq(email), argument.capture());
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
