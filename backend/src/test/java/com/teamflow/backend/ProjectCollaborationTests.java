package com.teamflow.backend;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.Task;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.ProjectMemberRepository;
import com.teamflow.backend.repository.ProjectRepository;
import com.teamflow.backend.repository.TaskRepository;
import com.teamflow.backend.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.transaction.TestTransaction;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.WebApplicationContext;

import java.util.UUID;
import java.util.regex.Pattern;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@Transactional
class ProjectCollaborationTests {

    @Autowired private WebApplicationContext context;
    @Autowired private UserRepository users;
    @Autowired private ProjectRepository projects;
    @Autowired private ProjectMemberRepository members;
    @Autowired private TaskRepository tasks;

    private MockMvc mvc;
    private User owner;
    private User invitee;
    private User outsider;
    private Project project;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        owner = addUser("owner");
        invitee = addUser("invitee");
        outsider = addUser("outsider");
        project = addProject(owner);
    }

    @Test
    void acceptanceGrantsProjectAndTaskAccessWhileOwnerKeepsManagement() throws Exception {
        mvc.perform(get("/api/projects")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/projects").with(user(owner.getEmail())).session(session(owner)))
                .andExpect(jsonPath("$[0].id").value(project.getId()));
        mvc.perform(get("/api/projects/{id}/members", project.getId())
                        .with(user(owner.getEmail())).session(session(owner)))
                .andExpect(jsonPath("$[0].role").value("OWNER"));

        Long invitationId = invite(invitee);
        mvc.perform(get("/api/projects/invitations").with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(jsonPath("$[0].id").value(invitationId))
                .andExpect(jsonPath("$[0].password").doesNotExist());
        assertBlocked(invitee);
        assertBlocked(outsider);
        respond(outsider, invitationId, "accept").andExpect(status().isNotFound());
        respond(invitee, invitationId, "accept").andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACCEPTED"));
        respond(invitee, invitationId, "reject").andExpect(status().isConflict());
        sendInvite(invitee).andExpect(status().isConflict());

        mvc.perform(get("/api/projects").with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(jsonPath("$[0].id").value(project.getId()));
        mvc.perform(get("/api/projects/{id}", project.getId())
                        .with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/projects/{id}/members", project.getId())
                        .with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(jsonPath("$[1].role").value("MEMBER"));
        mvc.perform(put("/api/projects/{id}", project.getId()).contentType("application/json")
                        .content("{\"name\":\"Changed\"}").with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/projects/{id}", project.getId())
                        .with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/{id}/invitations", project.getId())
                        .with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/projects/{id}/invitations", project.getId()).contentType("application/json")
                        .content("{\"email\":\"" + outsider.getEmail() + "\"}")
                        .with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNotFound());

        Project unrelatedProject = addProject(outsider);
        Task unrelatedTask = tasks.save(new Task(unrelatedProject.getId(), "Private", "", "TODO"));
        mvc.perform(post("/api/tasks").contentType("application/json")
                        .content("{\"id\":" + unrelatedTask.getId() + ",\"projectId\":" + project.getId()
                                + ",\"title\":\"Shared\"}").with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isCreated());
        assertThat(tasks.findById(unrelatedTask.getId()).orElseThrow().getTitle()).isEqualTo("Private");
        Long taskId = tasks.findByProjectId(project.getId()).getFirst().getId();
        mvc.perform(get("/api/tasks/project/{id}", project.getId())
                        .with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(jsonPath("$[0].title").value("Shared"));
        mvc.perform(put("/api/tasks/{id}", taskId).contentType("application/json")
                        .content("{\"title\":\"Edited\",\"projectId\":" + unrelatedProject.getId() + "}")
                        .with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(jsonPath("$.projectId").value(project.getId()));
        mvc.perform(patch("/api/tasks/{id}/status", taskId).contentType("application/json")
                        .content("{\"status\":\"DONE\"}").with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(jsonPath("$.status").value("DONE"));
        mvc.perform(delete("/api/tasks/{id}", taskId)
                        .with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNoContent());
        assertThat(tasks.findById(taskId)).isEmpty();
    }

    @Test
    void rejectionKeepsAccessBlockedAndOwnerDeletionClearsInvitations() throws Exception {
        sendInvite(owner).andExpect(status().isConflict());
        sendInvite(new User("Missing", "missing-" + UUID.randomUUID() + "@example.test", "unused"))
                .andExpect(status().isNotFound());
        Long invitationId = invite(invitee);
        sendInvite(invitee).andExpect(status().isConflict());
        respond(invitee, invitationId, "reject").andExpect(jsonPath("$.status").value("REJECTED"));
        assertBlocked(invitee);
        sendInvite(invitee).andExpect(status().isConflict());
        mvc.perform(get("/api/projects/{id}/invitations", project.getId())
                        .with(user(owner.getEmail())).session(session(owner)))
                .andExpect(jsonPath("$[0].status").value("REJECTED"));
        mvc.perform(delete("/api/projects/{id}", project.getId())
                        .with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isNoContent());
        projects.flush();
        assertThat(members.existsByProjectIdAndUserId(project.getId(), invitee.getId())).isFalse();
        assertThat(users.existsById(owner.getId())).isTrue();
        assertThat(users.existsById(invitee.getId())).isTrue();
    }

    private void assertBlocked(User user) throws Exception {
        mvc.perform(get("/api/projects").with(user(user.getEmail())).session(session(user)))
                .andExpect(jsonPath("$").isEmpty());
        mvc.perform(get("/api/projects/{id}", project.getId()).with(user(user.getEmail())).session(session(user)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/tasks/project/{id}", project.getId())
                        .with(user(user.getEmail())).session(session(user)))
                .andExpect(status().isNotFound());
    }

    private Long invite(User invitee) throws Exception {
        sendInvite(invitee).andExpect(status().isCreated()).andExpect(jsonPath("$.status").value("PENDING"));
        return members.findByProjectIdOrderById(project.getId()).getFirst().getId();
    }

    @Test
    void eventStreamRequiresSessionProjectAccessAndSameOrigin() throws Exception {
        var request = get("/api/projects/{id}/events", project.getId());
        mvc.perform(request).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/projects/{id}/events", project.getId()).with(user(owner.getEmail())))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/projects/{id}/events", project.getId())
                        .header("Origin", "https://untrusted.example")
                        .with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/projects/{id}/events", project.getId())
                        .header("Sec-Fetch-Site", "cross-site")
                        .with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isForbidden());
        invite(invitee);
        for (User denied : new User[]{invitee, outsider}) {
            mvc.perform(get("/api/projects/{id}/events", project.getId())
                            .with(user(denied.getEmail())).session(session(denied)))
                    .andExpect(status().isNotFound());
        }
        mvc.perform(get("/api/projects/{id}/events", Long.MAX_VALUE)
                        .with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isNotFound());
    }

    @Test
    void eventStreamsSendOnlyCommittedChangesAndCloseAfterAccessLoss() throws Exception {
        Long invitationId = invite(invitee);
        respond(invitee, invitationId, "accept").andExpect(status().isOk());
        Project otherProject = addProject(outsider);
        TestTransaction.flagForCommit();
        TestTransaction.end();

        MockHttpSession ownerSession = session(owner);
        MockHttpSession memberSession = session(invitee);
        MockHttpSession outsiderSession = session(outsider);
        try {
            MvcResult ownerStream = openStream(project, owner, ownerSession);
            MvcResult memberStream = openStream(project, invitee, memberSession);
            MvcResult otherStream = openStream(otherProject, outsider, outsiderSession);

            TestTransaction.start();
            long rolledBackId = createTask(ownerSession);
            TestTransaction.flagForRollback();
            TestTransaction.end();

            long taskId = createTask(ownerSession);
            mvc.perform(put("/api/tasks/{id}", taskId).with(user(owner.getEmail())).session(ownerSession)
                            .contentType("application/json").content("{\"title\":\"private task title\"}"))
                    .andExpect(status().isOk());
            mvc.perform(patch("/api/tasks/{id}/status", taskId).with(user(owner.getEmail())).session(ownerSession)
                            .contentType("application/json").content("{\"status\":\"DONE\"}"))
                    .andExpect(status().isOk());
            mvc.perform(delete("/api/tasks/{id}", taskId).with(user(owner.getEmail())).session(ownerSession))
                    .andExpect(status().isNoContent());

            for (MvcResult stream : new MvcResult[]{ownerStream, memberStream}) {
                String content = awaitEvent(stream, "DELETED");
                assertThat(content).contains("event:task-changed", "\"projectId\":" + project.getId(),
                                "\"taskId\":" + taskId, "CREATED", "UPDATED", "STATUS_CHANGED", "DELETED")
                        .doesNotContain("\"taskId\":" + rolledBackId + ",", "private task title", owner.getEmail());
                assertThat(Pattern.compile("event:task-changed").matcher(content).results().count()).isEqualTo(4);
            }

            members.deleteById(invitationId);
            long nextTaskId = createTask(ownerSession);
            memberStream.getAsyncResult(7000);
            assertThat(memberStream.getResponse().getContentAsString()).doesNotContain("\"taskId\":" + nextTaskId + ",");
            awaitEvent(ownerStream, "\"taskId\":" + nextTaskId + ",");
            assertThat(otherStream.getResponse().getContentAsString()).doesNotContain("event:task-changed");

            mvc.perform(post("/api/auth/logout").session(ownerSession)).andExpect(status().isOk());
            ownerStream.getAsyncResult(7000);
        } finally {
            for (MockHttpSession session : new MockHttpSession[]{ownerSession, memberSession, outsiderSession}) {
                if (!session.isInvalid()) {
                    session.invalidate();
                }
            }
            if (TestTransaction.isActive()) {
                TestTransaction.flagForRollback();
                TestTransaction.end();
            }
            TestTransaction.start();
            tasks.deleteAll(tasks.findByProjectId(project.getId()));
            members.deleteAll(members.findByProjectIdOrderById(project.getId()));
            projects.deleteById(project.getId());
            projects.deleteById(otherProject.getId());
            users.deleteAllById(java.util.List.of(owner.getId(), invitee.getId(), outsider.getId()));
            TestTransaction.flagForCommit();
            TestTransaction.end();
        }
    }

    private MvcResult openStream(Project target, User user, MockHttpSession session) throws Exception {
        return mvc.perform(get("/api/projects/{id}/events", target.getId())
                        .header("Origin", "http://localhost")
                        .with(user(user.getEmail())).session(session))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(request().asyncStarted()).andReturn();
    }

    private long createTask(MockHttpSession session) throws Exception {
        String response = mvc.perform(post("/api/tasks").with(user(owner.getEmail())).session(session)
                        .contentType("application/json")
                        .content("{\"projectId\":" + project.getId() + ",\"title\":\"private task title\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        var id = Pattern.compile("\"id\"\\s*:\\s*(\\d+)").matcher(response);
        assertThat(id.find()).isTrue();
        return Long.parseLong(id.group(1));
    }

    private String awaitEvent(MvcResult stream, String marker) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(7);
        String content;
        do {
            content = stream.getResponse().getContentAsString();
            if (content.contains(marker)) {
                return content;
            }
            Thread.sleep(50);
        } while (System.nanoTime() < deadline);
        assertThat(content).contains(marker);
        return content;
    }

    private org.springframework.test.web.servlet.ResultActions sendInvite(User invitee) throws Exception {
        return mvc.perform(post("/api/projects/{id}/invitations", project.getId())
                .contentType("application/json").content("{\"email\":\"" + invitee.getEmail() + "\"}")
                .with(user(owner.getEmail())).session(session(owner)));
    }

    private org.springframework.test.web.servlet.ResultActions respond(User user, Long id, String action)
            throws Exception {
        return mvc.perform(post("/api/projects/invitations/{id}/{action}", id, action)
                .with(user(user.getEmail())).session(session(user)));
    }

    private User addUser(String name) {
        return users.save(new User(name, name + "-" + UUID.randomUUID() + "@example.test", "unused"));
    }

    private Project addProject(User owner) {
        Project project = new Project("Project", "Description");
        project.setOwner(owner);
        return projects.save(project);
    }

    private MockHttpSession session(User user) {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("userId", user.getId());
        return session;
    }
}
