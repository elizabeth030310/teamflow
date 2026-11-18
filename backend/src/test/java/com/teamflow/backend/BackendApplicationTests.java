package com.teamflow.backend;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.WebApplicationContext;

import java.util.UUID;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
class BackendApplicationTests {
	@Autowired
	private WebApplicationContext context;

	@Test
	void contextLoads() {
	}

	@Test
	@Transactional
	void authenticationHandlesTheBcryptByteLimitAndSessionLifecycle() throws Exception {
		MockMvc mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
		String email = UUID.randomUUID() + "@example.test";
		String password = "가".repeat(24);
		String signup = """
				{"name":"Tester","email":"%s","password":"%s"}
				""";
		String login = """
				{"email":"%s","password":"%s"}
				""";

		mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
						.content(signup.formatted(email, password + "a")))
				.andExpect(status().isBadRequest());
		mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
						.content(signup.formatted(email, password)))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.password").doesNotHaveJsonPath());
		mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
						.content(signup.formatted(email, password)))
				.andExpect(status().isConflict());
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

}
