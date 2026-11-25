package com.teamflow.backend;

import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@IsolatedSpringBootTest
@Sql(scripts = {"file:db/193-a-project-pages.sql", "file:db/193-d-project-page-content-format.sql"})
class VercelCollaborationContractTest {
    @Autowired private WebApplicationContext context;
    @Autowired private UserRepository users;
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void springAndNodeCollaborationContractsMatchOnDisposablePostgres() throws Exception {
        MockMvc mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        User owner = fixture("Owner");
        User member = fixture("Member");
        User outsider = fixture("Outsider");
        Map<String, Object> contracts = new LinkedHashMap<>();
        var project = mvc.perform(as(post("/api/projects"), owner, Map.of("name", "Parity", "description", "Team"))).andReturn();
        long projectId = identifier(project, 201);
        capture(contracts, "project", project);
        String projectPath = "/api/projects/" + projectId;
        capture(contracts, "privateProject", mvc.perform(as(get(projectPath), outsider, null)).andReturn());
        capture(contracts, "updatedProject", mvc.perform(as(put(projectPath), owner, Map.of("name", "Renamed", "description", "Team"))).andReturn());
        var invite = mvc.perform(as(post(projectPath + "/invitations"), owner, Map.of("email", member.getEmail()))).andReturn();
        long invitationId = identifier(invite, 201);
        capture(contracts, "invite", invite);
        capture(contracts, "inviteCooldown", mvc.perform(as(post(projectPath + "/invitations/" + invitationId + "/resend"), owner, null)).andReturn());
        capture(contracts, "accept", mvc.perform(as(post("/api/projects/invitations/" + invitationId + "/accept"), member, null)).andReturn());

        var page = mvc.perform(as(post(projectPath + "/pages"), member, Map.of("title", "Root", "content", "{\"type\":\"doc\"}", "contentFormat", "rich-v1"))).andReturn();
        long pageId = identifier(page, 201);
        capture(contracts, "page", page);
        String updatedAt = json.readTree(page.getResponse().getContentAsByteArray()).get("updatedAt").asText();
        String pagePath = projectPath + "/pages/" + pageId;
        capture(contracts, "updatedPage", mvc.perform(as(put(pagePath), owner,
                Map.of("title", "Updated", "expectedUpdatedAt", updatedAt))).andReturn());
        capture(contracts, "stalePage", mvc.perform(as(put(pagePath), member,
                Map.of("title", "Stale", "expectedUpdatedAt", updatedAt))).andReturn());

        var task = mvc.perform(as(post("/api/tasks"), member, Map.of("projectId", projectId, "title", "Task", "dueDate", "2030-02-28"))).andReturn();
        long taskId = identifier(task, 201);
        capture(contracts, "task", task);
        String taskPath = "/api/tasks/" + taskId;
        capture(contracts, "assign", mvc.perform(as(patch(taskPath + "/assignee"), owner, Map.of("assigneeId", member.getId()))).andReturn());
        capture(contracts, "status", mvc.perform(as(patch(taskPath + "/status"), member, Map.of("status", "DONE"))).andReturn());
        var item = mvc.perform(as(post(taskPath + "/checklist-items"), member, Map.of("title", "Checklist"))).andReturn();
        long itemId = identifier(item, 201);
        capture(contracts, "checklist", item);
        capture(contracts, "completed", mvc.perform(as(patch(taskPath + "/checklist-items/" + itemId), owner, Map.of("completed", true))).andReturn());
        var comment = mvc.perform(as(post(taskPath + "/comments"), owner, Map.of("content", "Root comment"))).andReturn();
        long commentId = identifier(comment, 201);
        capture(contracts, "comment", comment);
        capture(contracts, "reply", mvc.perform(as(post(taskPath + "/comments"), member,
                Map.of("content", "Reply", "parentCommentId", commentId))).andReturn());
        capture(contracts, "foreignCommentEdit", mvc.perform(as(patch(taskPath + "/comments/" + commentId), member,
                Map.of("content", "No"))).andReturn());

        var process = new ProcessBuilder("node", "integration/compare-collaboration.mjs")
                .directory(Path.of("..", "deploy", "vercel", "functions").toFile()).redirectErrorStream(true).start();
        try {
            try (var input = process.getOutputStream()) {
                json.writeValue(input, Map.of("owner", owner.getEmail(), "member", member.getEmail(),
                        "outsider", outsider.getEmail(), "contracts", contracts));
            }
            assertThat(process.waitFor(65, TimeUnit.SECONDS)).isTrue();
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            assertThat(process.exitValue()).withFailMessage("Node collaboration test failed:%n%s", output).isZero();
        } finally {
            if (process.isAlive()) process.destroyForcibly();
        }
    }

    private User fixture(String name) {
        return users.save(new User(name, UUID.randomUUID() + "@example.test", "unused"));
    }

    private MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request, User account, Object body) {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("userId", account.getId());
        session.setAttribute("accessRevision", account.getAccessRevision());
        request.session(session).with(user(account.getEmail())).header("X-TeamFlow-Request", "1");
        if (body != null) request.contentType("application/json").content(json.writeValueAsString(body));
        return request;
    }

    private long identifier(MvcResult result, int expected) throws Exception {
        assertThat(result.getResponse().getStatus()).isEqualTo(expected);
        return json.readTree(result.getResponse().getContentAsByteArray()).get("id").asLong();
    }

    private void capture(Map<String, Object> contracts, String name, MvcResult result) throws Exception {
        int status = result.getResponse().getStatus();
        contracts.put(name, status >= 200 && status < 204 ? Map.of("status", status,
                "body", json.readTree(result.getResponse().getContentAsByteArray())) : Map.of("status", status));
    }
}
