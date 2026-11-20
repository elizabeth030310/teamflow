package com.teamflow.backend;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.Task;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.ProjectMemberRepository;
import com.teamflow.backend.repository.ProjectRepository;
import com.teamflow.backend.repository.TaskCommentRepository;
import com.teamflow.backend.repository.TaskRepository;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.NotificationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.transaction.TestTransaction;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.WebApplicationContext;

import java.time.LocalDate;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@IsolatedSpringBootTest
@Transactional
class ProjectCollaborationTests {

    @Autowired private WebApplicationContext context;
    @Autowired private UserRepository users;
    @Autowired private ProjectRepository projects;
    @Autowired private ProjectMemberRepository members;
    @Autowired private TaskRepository tasks;
    @Autowired private TaskCommentRepository comments;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private NotificationService notifications;

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
    void notificationsArePrivateAndSupportIndividualAndBulkRead() throws Exception {
        long invitationId = invite(invitee);
        respond(invitee, invitationId, "accept").andExpect(status().isOk());
        long taskId = createTask(session(owner));
        changeAssignee(owner, taskId, assigneeBody(owner.getId())).andExpect(status().isOk());
        inbox(owner).andExpect(jsonPath("$.unreadCount").value(0));
        changeAssignee(owner, taskId, assigneeBody(invitee.getId())).andExpect(status().isOk());
        changeAssignee(owner, taskId, assigneeBody(invitee.getId())).andExpect(status().isOk());
        postStreamTestComment(taskId, session(owner)).andExpect(status().isCreated());
        mvc.perform(post("/api/tasks/{id}/comments", taskId).with(user(invitee.getEmail()))
                        .session(session(invitee)).contentType("application/json").content("{\"content\":\"Reply\"}"))
                .andExpect(status().isCreated());

        mvc.perform(get("/api/notifications")).andExpect(status().isUnauthorized());
        inbox(invitee).andExpect(jsonPath("$.unreadCount").value(2))
                .andExpect(jsonPath("$.items[0].kind").value("COMMENT"))
                .andExpect(jsonPath("$.items[1].kind").value("ASSIGNMENT"))
                .andExpect(jsonPath("$.items[0].taskId").value(taskId))
                .andExpect(jsonPath("$.items[0].projectId").value(project.getId()));
        inbox(owner).andExpect(jsonPath("$.unreadCount").value(1));
        inbox(outsider).andExpect(jsonPath("$.items").isEmpty());
        long id = jdbc.queryForObject("select id from notifications where recipient_id = ? and kind = 'COMMENT'",
                Long.class, invitee.getId());
        for (User actor : new User[]{outsider, owner, invitee, invitee}) {
            mvc.perform(patch("/api/notifications/{id}/read", id).with(user(actor.getEmail())).session(session(actor)))
                    .andExpect(actor == invitee ? status().isNoContent() : status().isNotFound());
        }
        inbox(invitee).andExpect(jsonPath("$.unreadCount").value(1))
                .andExpect(jsonPath("$.items[0].read").value(true));
        mvc.perform(patch("/api/notifications/read-all").with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNoContent());
        inbox(invitee).andExpect(jsonPath("$.unreadCount").value(0));
        inbox(owner).andExpect(jsonPath("$.unreadCount").value(1));
        members.deleteById(invitationId);
        members.flush();
        inbox(invitee).andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    void deadlineNotificationsDeduplicatePerStageAndDueDate() throws Exception {
        LocalDate today = LocalDate.of(2028, 2, 27);
        Task active = tasks.save(new Task(project.getId(), "Active", "", "TODO", "MEDIUM", today.plusDays(3)));
        tasks.save(new Task(project.getId(), "Done", "", "DONE", "MEDIUM", today.minusDays(1)));
        tasks.save(new Task(project.getId(), "Later", "", "TODO", "MEDIUM", today.plusDays(8)));
        tasks.save(new Task(project.getId(), "Undated", "", "TODO"));
        notifications.generateDeadlines(today);
        notifications.generateDeadlines(today.plusDays(3));
        notifications.generateDeadlines(today.plusDays(4));
        notifications.generateDeadlines(today.plusDays(4));
        active.setDueDate(today.plusDays(5));
        tasks.flush();
        notifications.generateDeadlines(today.plusDays(4));
        inbox(owner).andExpect(jsonPath("$.unreadCount").value(3))
                .andExpect(jsonPath("$.items[0].kind").value("DUE_SOON"))
                .andExpect(jsonPath("$.items[0].dueDate").value(today.plusDays(5).toString()))
                .andExpect(jsonPath("$.items[1].kind").value("OVERDUE"))
                .andExpect(jsonPath("$.items[2].kind").value("DUE_SOON"))
                .andExpect(jsonPath("$.items[2].taskId").value(active.getId()));
    }

    private ResultActions inbox(User actor) throws Exception {
        return mvc.perform(get("/api/notifications").with(user(actor.getEmail())).session(session(actor)))
                .andExpect(status().isOk());
    }

    @Test
    void taskDueDateCanBeCreatedRescheduledAndCleared() throws Exception {
        MockHttpSession ownerSession = session(owner);
        mvc.perform(post("/api/tasks").with(user(owner.getEmail())).session(ownerSession)
                        .contentType("application/json").content("""
                                {"projectId":%d,"title":"Release","dueDate":"2028-02-29"}
                                """.formatted(project.getId())))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.dueDate").value("2028-02-29"));
        long taskId = tasks.findByProjectId(project.getId()).getFirst().getId();

        String newDate = """
                {"title":"Release","dueDate":"2028-03-01"}
                """;
        mvc.perform(put("/api/tasks/{id}", taskId).with(user(outsider.getEmail())).session(session(outsider))
                        .contentType("application/json").content(newDate))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/tasks/{id}", taskId).with(user(owner.getEmail())).session(ownerSession)
                        .contentType("application/json").content(newDate))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dueDate").value("2028-03-01"));
        tasks.flush();
        assertThat(jdbc.queryForObject("select due_date from tasks where id = ?", LocalDate.class, taskId))
                .isEqualTo(LocalDate.of(2028, 3, 1));

        mvc.perform(put("/api/tasks/{id}", taskId).with(user(owner.getEmail())).session(ownerSession)
                        .contentType("application/json").content("""
                                {"title":"Release","dueDate":null}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dueDate").value(nullValue()));
        mvc.perform(get("/api/tasks/project/{id}", project.getId()).with(user(owner.getEmail())).session(ownerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].dueDate").value(nullValue()));
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
        assertThat(jdbc.queryForList("""
                select task_id, task_title, type, actor_id, actor_name, created_at
                from task_activities where project_id = ?
                """, project.getId())).singleElement().satisfies(activity -> {
            assertThat(activity).containsEntry("task_id", taskId)
                    .containsEntry("task_title", "Shared")
                    .containsEntry("type", "TASK_CREATED")
                    .containsEntry("actor_id", invitee.getId())
                    .containsEntry("actor_name", invitee.getName());
            assertThat(activity.get("created_at")).isNotNull();
        });
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
    void recordsOnlySuccessfulStatusChangesWithPreviousStatusAndActor() throws Exception {
        Long invitationId = invite(invitee);
        respond(invitee, invitationId, "accept").andExpect(status().isOk());
        long taskId = createTask(session(owner));

        changeStatus(outsider, session(outsider), taskId, "DONE").andExpect(status().isNotFound());
        changeStatus(invitee, session(invitee), taskId, "INVALID").andExpect(status().isBadRequest());
        changeStatus(invitee, session(invitee), taskId, "IN_PROGRESS").andExpect(status().isOk());
        changeStatus(invitee, session(invitee), taskId, "IN_PROGRESS").andExpect(status().isOk());
        changeStatus(owner, session(owner), taskId, "DONE").andExpect(status().isOk());

        assertThat(jdbc.queryForList("""
                select previous_status, new_status, actor_id, actor_name
                from task_activities where task_id = ? and type = 'TASK_STATUS_CHANGED' order by id
                """, taskId)).satisfiesExactly(first -> assertThat(first)
                        .containsEntry("previous_status", "TODO").containsEntry("new_status", "IN_PROGRESS")
                        .containsEntry("actor_id", invitee.getId()).containsEntry("actor_name", invitee.getName()),
                second -> assertThat(second)
                        .containsEntry("previous_status", "IN_PROGRESS").containsEntry("new_status", "DONE")
                        .containsEntry("actor_id", owner.getId()).containsEntry("actor_name", owner.getName()));
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

    @Test
    void taskAssigneeCanBeSetChangedAndExplicitlyCleared() throws Exception {
        respond(invitee, invite(invitee), "accept").andExpect(status().isOk());
        long taskId = createTask(session(owner));
        assertThat(storedAssignee(taskId)).isNull();

        changeAssignee(owner, taskId, assigneeBody(owner.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assigneeId").value(owner.getId()));
        changeAssignee(invitee, taskId, assigneeBody(invitee.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assigneeId").value(invitee.getId()))
                .andExpect(jsonPath("$.email").doesNotExist())
                .andExpect(jsonPath("$.password").doesNotExist());

        mvc.perform(put("/api/tasks/{id}", taskId).contentType("application/json")
                        .content("{\"title\":\"Edited\"}")
                        .with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assigneeId").value(invitee.getId()));
        mvc.perform(get("/api/tasks/project/{id}", project.getId())
                        .with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].assigneeId").value(invitee.getId()));
        assertThat(storedAssignee(taskId)).isEqualTo(invitee.getId());

        changeAssignee(invitee, taskId, assigneeBody(invitee.getId())).andExpect(status().isOk());
        changeAssignee(invitee, taskId, "{\"assigneeId\":null}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assigneeId").value(nullValue()));
        changeAssignee(invitee, taskId, "{\"assigneeId\":null}").andExpect(status().isOk());
        assertThat(storedAssignee(taskId)).isNull();

        assertThat(jdbc.queryForList("""
                select previous_assignee_id, new_assignee_id, actor_id, actor_name
                from task_activities where task_id = ? and type = 'TASK_ASSIGNEE_CHANGED' order by id
                """, taskId)).satisfiesExactly(
                assigned -> assertThat(assigned)
                        .containsEntry("previous_assignee_id", null).containsEntry("new_assignee_id", owner.getId())
                        .containsEntry("actor_id", owner.getId()),
                changed -> assertThat(changed)
                        .containsEntry("previous_assignee_id", owner.getId())
                        .containsEntry("new_assignee_id", invitee.getId()).containsEntry("actor_id", invitee.getId()),
                cleared -> assertThat(cleared)
                        .containsEntry("previous_assignee_id", invitee.getId()).containsEntry("new_assignee_id", null)
                        .containsEntry("actor_id", invitee.getId()).containsEntry("actor_name", invitee.getName()));
    }

    @Test
    void taskAssigneeRejectsIneligibleTargetsAndUnauthorizedActors() throws Exception {
        Long invitationId = invite(invitee);
        Project otherProject = addProject(outsider);
        mvc.perform(post("/api/projects/{id}/invitations", otherProject.getId())
                        .contentType("application/json").content("{\"email\":\"" + invitee.getEmail() + "\"}")
                        .with(user(outsider.getEmail())).session(session(outsider)))
                .andExpect(status().isCreated());
        Long otherInvitationId = members.findByProjectIdOrderById(otherProject.getId()).getFirst().getId();
        respond(invitee, otherInvitationId, "accept").andExpect(status().isOk());

        long taskId = createTask(session(owner));
        changeAssignee(owner, taskId, assigneeBody(owner.getId())).andExpect(status().isOk());
        changeAssignee(invitee, taskId, "{\"assigneeId\":null}").andExpect(status().isNotFound());
        changeAssignee(outsider, taskId, "{\"assigneeId\":null}").andExpect(status().isNotFound());
        mvc.perform(patch("/api/tasks/{id}/assignee", taskId)
                        .contentType("application/json").content("{\"assigneeId\":null}"))
                .andExpect(status().isUnauthorized());

        changeAssignee(owner, taskId, assigneeBody(invitee.getId())).andExpect(status().isBadRequest());
        respond(invitee, invitationId, "reject").andExpect(status().isOk());
        changeAssignee(owner, taskId, assigneeBody(invitee.getId())).andExpect(status().isBadRequest());
        changeAssignee(owner, taskId, assigneeBody(outsider.getId())).andExpect(status().isBadRequest());
        changeAssignee(owner, taskId, assigneeBody(Long.MAX_VALUE)).andExpect(status().isBadRequest());
        for (String malformed : new String[]{"{}", "{\"assigneeId\":1.5}",
                "{\"assigneeId\":\"1\"}", "{\"assigneeId\":9223372036854775808}"}) {
            changeAssignee(owner, taskId, malformed).andExpect(status().isBadRequest());
        }
        assertThat(storedAssignee(taskId)).isEqualTo(owner.getId());
        assertThat(jdbc.queryForObject("""
                select count(*) from task_activities where task_id = ? and type = 'TASK_ASSIGNEE_CHANGED'
                """, Long.class, taskId)).isEqualTo(1L);
    }

    private Long storedAssignee(long taskId) {
        tasks.flush();
        return jdbc.queryForObject("select assignee_id from tasks where id = ?", Long.class, taskId);
    }

    private ResultActions changeAssignee(User actor, long taskId, String body) throws Exception {
        return mvc.perform(patch("/api/tasks/{id}/assignee", taskId)
                .contentType("application/json").content(body)
                .with(user(actor.getEmail())).session(session(actor)));
    }

    private String assigneeBody(Long assigneeId) {
        return "{\"assigneeId\":" + assigneeId + "}";
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
    void checklistItemsFollowTaskPermissionsAndStoreAnExplicitCompletionState() throws Exception {
        long taskId = createTask(session(owner));
        long otherTaskId = createTask(session(owner));
        String path = "/api/tasks/{taskId}/checklist-items";
        String itemPath = path + "/{itemId}";
        Long invitationId = invite(invitee);

        mvc.perform(get(path, taskId)).andExpect(status().isUnauthorized());
        for (User denied : new User[]{invitee, outsider}) {
            mvc.perform(get(path, taskId).with(user(denied.getEmail())).session(session(denied)))
                    .andExpect(status().isNotFound());
            mvc.perform(post(path, taskId).with(user(denied.getEmail())).session(session(denied))
                            .contentType("application/json").content("{\"title\":\"Review\"}"))
                    .andExpect(status().isNotFound());
        }

        respond(invitee, invitationId, "accept").andExpect(status().isOk());
        MockHttpSession memberSession = session(invitee);
        mvc.perform(get(path, taskId).with(user(invitee.getEmail())).session(memberSession))
                .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        for (String invalid : new String[]{"{}", "{\"title\":12}", "{\"title\":\"  \"}",
                "{\"title\":\"" + "a".repeat(201) + "\"}"}) {
            mvc.perform(post(path, taskId).with(user(invitee.getEmail())).session(memberSession)
                            .contentType("application/json").content(invalid))
                    .andExpect(status().isBadRequest());
        }

        mvc.perform(post(path, taskId).with(user(owner.getEmail())).session(session(owner))
                        .contentType("application/json").content("{\"title\":\"  Review  \",\"completed\":true}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("Review"))
                .andExpect(jsonPath("$.completed").value(false));
        Long itemId = jdbc.queryForObject("select id from task_checklist_items where task_id = ?", Long.class, taskId);

        mvc.perform(patch(itemPath, taskId, itemId).with(user(outsider.getEmail())).session(session(outsider))
                        .contentType("application/json").content("{\"completed\":true}"))
                .andExpect(status().isNotFound());
        mvc.perform(delete(itemPath, taskId, itemId).with(user(outsider.getEmail())).session(session(outsider)))
                .andExpect(status().isNotFound());
        mvc.perform(patch(itemPath, otherTaskId, itemId).with(user(invitee.getEmail())).session(memberSession)
                        .contentType("application/json").content("{\"completed\":true}"))
                .andExpect(status().isNotFound());
        mvc.perform(delete(itemPath, otherTaskId, itemId).with(user(invitee.getEmail())).session(memberSession))
                .andExpect(status().isNotFound());

        mvc.perform(patch(itemPath, taskId, itemId).with(user(invitee.getEmail())).session(memberSession)
                        .contentType("application/json").content("{\"completed\":\"true\"}"))
                .andExpect(status().isBadRequest());
        for (boolean completed : new boolean[]{true, true, false}) {
            mvc.perform(patch(itemPath, taskId, itemId).with(user(invitee.getEmail())).session(memberSession)
                            .contentType("application/json").content("{\"completed\":" + completed + "}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.completed").value(completed));
            mvc.perform(get(path, taskId).with(user(owner.getEmail())).session(session(owner)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[0].id").value(itemId))
                    .andExpect(jsonPath("$[0].completed").value(completed));
        }

        mvc.perform(delete(itemPath, taskId, itemId).with(user(invitee.getEmail())).session(memberSession))
                .andExpect(status().isNoContent());
        mvc.perform(get(path, taskId).with(user(invitee.getEmail())).session(memberSession))
                .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
    }

    @Test
    void deletingTaskRemovesItsChecklistItems() throws Exception {
        MockHttpSession ownerSession = session(owner);
        long taskId = createTask(ownerSession);
        mvc.perform(post("/api/tasks/{taskId}/checklist-items", taskId)
                        .with(user(owner.getEmail())).session(ownerSession)
                        .contentType("application/json").content("{\"title\":\"Review\"}"))
                .andExpect(status().isCreated());

        mvc.perform(delete("/api/tasks/{id}", taskId).with(user(owner.getEmail())).session(ownerSession))
                .andExpect(status().isNoContent());
        tasks.flush();
        assertThat(jdbc.queryForObject("select count(*) from task_checklist_items where task_id = ?",
                Long.class, taskId)).isZero();
    }

    @Test
    void commentsRequireProjectAccessAndOnlyTheirAuthorCanDeleteThem() throws Exception {
        long taskId = createTask(session(owner));
        long otherTaskId = createTask(session(owner));
        String path = "/api/tasks/{taskId}/comments";
        String deletePath = path + "/{commentId}";
        Long invitationId = invite(invitee);

        mvc.perform(get(path, taskId)).andExpect(status().isUnauthorized());
        for (User denied : new User[]{invitee, outsider}) {
            mvc.perform(get(path, taskId).with(user(denied.getEmail())).session(session(denied)))
                    .andExpect(status().isNotFound());
        }
        respond(invitee, invitationId, "accept").andExpect(status().isOk());

        for (String invalid : new String[]{"{}", "{\"content\":12}", "{\"content\":\"  \"}",
                "{\"content\":\"" + "a".repeat(1001) + "\"}"}) {
            mvc.perform(post(path, taskId).with(user(invitee.getEmail())).session(session(invitee))
                            .contentType("application/json").content(invalid))
                    .andExpect(status().isBadRequest());
        }

        mvc.perform(post(path, taskId).with(user(invitee.getEmail())).session(session(invitee))
                        .contentType("application/json")
                        .content("{\"content\":\"  Hello  \",\"authorId\":" + owner.getId() + "}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorId").value(invitee.getId()))
                .andExpect(jsonPath("$.content").value("Hello"));
        Long commentId = comments.findByTaskIdOrderByCreatedAtAscIdAsc(taskId).getFirst().getId();

        mvc.perform(get(path, taskId).with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(commentId));
        mvc.perform(delete(deletePath, taskId, commentId).with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isForbidden());
        mvc.perform(delete(deletePath, otherTaskId, commentId)
                        .with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNotFound());
        mvc.perform(delete(deletePath, taskId, commentId).with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNoContent());
        mvc.perform(delete(deletePath, taskId, commentId).with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNotFound());
        mvc.perform(get(path, taskId).with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());

        assertThat(jdbc.queryForList("""
                select type, task_id, actor_id, actor_name, created_at
                from task_activities where project_id = ? and type in ('COMMENT_CREATED', 'COMMENT_DELETED')
                order by id
                """, project.getId())).hasSize(2).allSatisfy(activity -> {
            assertThat(activity).containsEntry("task_id", taskId)
                    .containsEntry("actor_id", invitee.getId()).containsEntry("actor_name", invitee.getName());
            assertThat(activity.get("created_at")).isNotNull();
        }).extracting(activity -> activity.get("type")).containsExactly("COMMENT_CREATED", "COMMENT_DELETED");
    }

    @Test
    void commentRepliesStayWithinOneLevelAndTheirTask() throws Exception {
        respond(invitee, invite(invitee), "accept").andExpect(status().isOk());
        long taskId = createTask(session(owner));
        long otherTaskId = createTask(session(owner), addProject(owner));
        postTaskComment(owner, taskId, """
                {"content":"Parent"}
                """).andExpect(status().isCreated())
                .andExpect(jsonPath("$.parentCommentId").value(nullValue()))
                .andExpect(jsonPath("$.deleted").value(false));
        Long parentId = comments.findByTaskIdOrderByCreatedAtAscIdAsc(taskId).getFirst().getId();
        String replyBody = """
                {"content":"Reply","parentCommentId":%d}
                """.formatted(parentId);
        postTaskComment(outsider, taskId, replyBody).andExpect(status().isNotFound());
        postTaskComment(owner, otherTaskId, replyBody).andExpect(status().isNotFound());
        postTaskComment(invitee, taskId, replyBody).andExpect(status().isCreated())
                .andExpect(jsonPath("$.parentCommentId").value(parentId));
        Long replyId = comments.findByTaskIdOrderByCreatedAtAscIdAsc(taskId).getLast().getId();
        for (String invalidParent : new String[]{replyId.toString(), "0", "1.5", "\"1\"", "9223372036854775808"}) {
            postTaskComment(invitee, taskId, """
                    {"content":"Invalid","parentCommentId":%s}
                    """.formatted(invalidParent)).andExpect(status().isBadRequest());
        }

        editTaskComment(owner, taskId, replyId, """
                {"content":"Edited"}
                """).andExpect(status().isForbidden());
        editTaskComment(outsider, taskId, replyId, """
                {"content":"Edited"}
                """).andExpect(status().isNotFound());
        editTaskComment(owner, otherTaskId, replyId, """
                {"content":"Edited"}
                """).andExpect(status().isNotFound());
        editTaskComment(invitee, taskId, replyId, replyBody).andExpect(status().isBadRequest());
        editTaskComment(invitee, taskId, replyId, """
                {"content":"   "}
                """).andExpect(status().isBadRequest());
        editTaskComment(invitee, taskId, replyId, """
                {"content":"  Edited  "}
                """).andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("Edited"))
                .andExpect(jsonPath("$.parentCommentId").value(parentId));

        String commentsPath = "/api/tasks/{taskId}/comments";
        String commentPath = commentsPath + "/{commentId}";
        mvc.perform(delete(commentPath, taskId, replyId).with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isForbidden());
        mvc.perform(delete(commentPath, taskId, parentId).with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isNoContent());
        mvc.perform(get(commentsPath, taskId).with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(parentId))
                .andExpect(jsonPath("$[0].deleted").value(true))
                .andExpect(jsonPath("$[0].content").value(""))
                .andExpect(jsonPath("$[1].parentCommentId").value(parentId))
                .andExpect(jsonPath("$[1].content").value("Edited"));
        postTaskComment(invitee, taskId, replyBody).andExpect(status().isNotFound());
        editTaskComment(owner, taskId, parentId, """
                {"content":"Restore"}
                """).andExpect(status().isNotFound());

        mvc.perform(delete("/api/tasks/{id}", taskId).with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("select count(*) from task_comments where task_id = ?",
                Long.class, taskId)).isZero();
    }

    private ResultActions postTaskComment(User actor, long taskId, String body) throws Exception {
        return mvc.perform(post("/api/tasks/{taskId}/comments", taskId)
                .with(user(actor.getEmail())).session(session(actor))
                .contentType("application/json").content(body));
    }

    private ResultActions editTaskComment(User actor, long taskId, Long commentId, String body) throws Exception {
        return mvc.perform(patch("/api/tasks/{taskId}/comments/{commentId}", taskId, commentId)
                .with(user(actor.getEmail())).session(session(actor))
                .contentType("application/json").content(body));
    }

    @Test
    void deletingTaskKeepsItsActivityUntilProjectIsDeleted() throws Exception {
        respond(invitee, invite(invitee), "accept").andExpect(status().isOk());
        long taskId = createTask(session(owner));
        postStreamTestComment(taskId, session(owner)).andExpect(status().isCreated());
        mvc.perform(put("/api/tasks/{id}", taskId).with(user(owner.getEmail())).session(session(owner))
                        .contentType("application/json").content("{\"title\":\"Renamed task\"}"))
                .andExpect(status().isOk());

        mvc.perform(delete("/api/tasks/{id}", taskId).with(user(outsider.getEmail())).session(session(outsider)))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/tasks/{id}", taskId).with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNoContent());
        mvc.perform(delete("/api/tasks/{id}", taskId).with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNotFound());

        assertThat(jdbc.queryForObject("select count(*) from task_comments where task_id = ?",
                Long.class, taskId)).isZero();
        assertThat(jdbc.queryForList("""
                select type, task_title, actor_id, actor_name, created_at
                from task_activities where task_id = ? order by id
                """, taskId)).satisfiesExactly(
                created -> assertThat(created).containsEntry("type", "TASK_CREATED")
                        .containsEntry("task_title", "private task title"),
                commented -> assertThat(commented).containsEntry("type", "COMMENT_CREATED"),
                deleted -> {
                    assertThat(deleted).containsEntry("type", "TASK_DELETED")
                            .containsEntry("task_title", "Renamed task")
                            .containsEntry("actor_id", invitee.getId()).containsEntry("actor_name", invitee.getName());
                    assertThat(deleted.get("created_at")).isNotNull();
                });

        mvc.perform(delete("/api/projects/{id}", project.getId()).with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isNoContent());
        projects.flush();
        assertThat(jdbc.queryForObject("select count(*) from task_activities where project_id = ?",
                Long.class, project.getId())).isZero();
    }

    @Test
    void activitiesAreVisibleOnlyToProjectMembersAndExcludeOtherProjects() throws Exception {
        String path = "/api/projects/{projectId}/activities";
        Long invitationId = invite(invitee);
        Project otherProject = addProject(outsider);
        long taskId = createTask(session(owner));
        changeStatus(owner, session(owner), taskId, "DONE").andExpect(status().isOk());

        mvc.perform(get(path, project.getId())).andExpect(status().isUnauthorized());
        mvc.perform(get(path, project.getId()).with(user(owner.getEmail()))).andExpect(status().isUnauthorized());
        mvc.perform(get(path, project.getId()).with(user(invitee.getEmail())).session(session(invitee)))
                .andExpect(status().isNotFound());
        mvc.perform(get(path, project.getId()).with(user(outsider.getEmail())).session(session(outsider)))
                .andExpect(status().isNotFound());

        mvc.perform(get(path, otherProject.getId()).with(user(outsider.getEmail())).session(session(outsider)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
        respond(invitee, invitationId, "accept").andExpect(status().isOk());

        for (User reader : new User[]{owner, invitee}) {
            mvc.perform(get(path, project.getId()).with(user(reader.getEmail())).session(session(reader)))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.length()").value(2))
                    .andExpect(jsonPath("$[0].type").value("TASK_STATUS_CHANGED"))
                    .andExpect(jsonPath("$[0].taskId").value(taskId))
                    .andExpect(jsonPath("$[0].taskTitle").value("private task title"))
                    .andExpect(jsonPath("$[0].actorId").value(owner.getId()))
                    .andExpect(jsonPath("$[0].actorName").value(owner.getName()))
                    .andExpect(jsonPath("$[0].createdAt").isString())
                    .andExpect(jsonPath("$[0].previousStatus").value("TODO"))
                    .andExpect(jsonPath("$[0].newStatus").value("DONE"))
                    .andExpect(jsonPath("$[0].email").doesNotHaveJsonPath())
                    .andExpect(jsonPath("$[0].content").doesNotHaveJsonPath())
                    .andExpect(jsonPath("$[1].type").value("TASK_CREATED"));
        }
    }

    @Test
    void activitiesReturnAtMostFiftyNewestRowsWithIdBreakingTimestampTies() throws Exception {
        long taskId = createTask(session(owner));
        jdbc.update("""
                insert into task_activities (project_id, task_id, task_title, type, actor_id, actor_name, created_at)
                select ?, ?, 'Sample ' || sample_number, 'TASK_CREATED', ?, ?,
                       case when sample_number = 51 then timestamp with time zone '2000-01-01 00:00:00+00'
                            else timestamp with time zone '2099-01-01 00:00:00+00' end
                from generate_series(1, 51) as samples(sample_number) order by sample_number
                """, project.getId(), taskId, owner.getId(), owner.getName());

        mvc.perform(get("/api/projects/{projectId}/activities", project.getId())
                        .with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(50))
                .andExpect(jsonPath("$[0].taskTitle").value("Sample 50"))
                .andExpect(jsonPath("$[49].taskTitle").value("Sample 1"));
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
            MvcResult memberNotifications = openNotificationStream(invitee, memberSession);
            MvcResult outsiderNotifications = openNotificationStream(outsider, outsiderSession);

            TestTransaction.start();
            long rolledBackId = createTask(ownerSession);
            TestTransaction.flagForRollback();
            TestTransaction.end();

            assertThat(jdbc.queryForObject("select count(*) from task_activities where task_id = ?",
                    Long.class, rolledBackId)).isZero();
            long taskId = createTask(ownerSession);
            TestTransaction.start();
            changeStatus(owner, ownerSession, taskId, "IN_PROGRESS").andExpect(status().isOk());
            TestTransaction.flagForRollback();
            TestTransaction.end();
            assertThat(jdbc.queryForObject("""
                    select count(*) from task_activities where task_id = ? and type = 'TASK_STATUS_CHANGED'
                    """, Long.class, taskId)).isZero();

            TestTransaction.start();
            postStreamTestComment(taskId, ownerSession).andExpect(status().isCreated());
            TestTransaction.flagForRollback();
            TestTransaction.end();

            postStreamTestComment(taskId, ownerSession).andExpect(status().isCreated());
            Long commentId = comments.findByTaskIdOrderByCreatedAtAscIdAsc(taskId).getFirst().getId();
            TestTransaction.start();
            mvc.perform(delete("/api/tasks/{taskId}/comments/{commentId}", taskId, commentId)
                            .with(user(owner.getEmail())).session(ownerSession))
                    .andExpect(status().isNoContent());
            TestTransaction.flagForRollback();
            TestTransaction.end();
            assertThat(jdbc.queryForList("""
                    select type from task_activities where task_id = ? and type in ('COMMENT_CREATED', 'COMMENT_DELETED')
                    """, String.class, taskId)).containsExactly("COMMENT_CREATED");

            mvc.perform(delete("/api/tasks/{taskId}/comments/{commentId}", taskId, commentId)
                            .with(user(owner.getEmail())).session(ownerSession))
                    .andExpect(status().isNoContent());
            TestTransaction.start();
            changeAssignee(owner, taskId, assigneeBody(invitee.getId())).andExpect(status().isOk());
            TestTransaction.flagForRollback();
            TestTransaction.end();
            assertThat(jdbc.queryForObject("""
                    select count(*) from task_activities where task_id = ? and type = 'TASK_ASSIGNEE_CHANGED'
                    """, Long.class, taskId)).isZero();
            assertThat(jdbc.queryForObject("select count(*) from notifications where task_id = ?",
                    Long.class, taskId)).isZero();

            changeAssignee(owner, taskId, assigneeBody(invitee.getId()))
                    .andExpect(status().isOk());
            assertThat(awaitEvent(memberNotifications, "event:notifications-changed"))
                    .contains("data:refresh").doesNotContain("private task title", "taskId");
            changeAssignee(owner, taskId, assigneeBody(invitee.getId())).andExpect(status().isOk());
            mvc.perform(put("/api/tasks/{id}", taskId).with(user(owner.getEmail())).session(ownerSession)
                            .contentType("application/json").content("""
                                    {"title":"private task title","dueDate":"2028-02-29"}
                                    """))
                    .andExpect(status().isOk());
            mvc.perform(patch("/api/tasks/{id}/status", taskId).with(user(owner.getEmail())).session(ownerSession)
                            .contentType("application/json").content("{\"status\":\"DONE\"}"))
                    .andExpect(status().isOk());
            changeStatus(owner, ownerSession, taskId, "DONE").andExpect(status().isOk());
            String checklistPath = "/api/tasks/{taskId}/checklist-items";
            String checklistItemPath = checklistPath + "/{itemId}";
            mvc.perform(get("/api/tasks/project/{id}", project.getId())
                            .with(user(invitee.getEmail())).session(memberSession))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[0].dueDate").value("2028-02-29"))
                    .andExpect(jsonPath("$[0].checklistTotal").value(0))
                    .andExpect(jsonPath("$[0].checklistCompleted").value(0));
            mvc.perform(post(checklistPath, taskId).with(user(owner.getEmail())).session(ownerSession)
                            .contentType("application/json").content("{\"title\":\"private checklist title\"}"))
                    .andExpect(status().isCreated());
            Long itemId = jdbc.queryForObject(
                    "select id from task_checklist_items where task_id = ?", Long.class, taskId);

            TestTransaction.start();
            mvc.perform(patch(checklistItemPath, taskId, itemId).with(user(invitee.getEmail())).session(memberSession)
                            .contentType("application/json").content("{\"completed\":true}"))
                    .andExpect(status().isOk());
            TestTransaction.flagForRollback();
            TestTransaction.end();

            mvc.perform(get("/api/tasks/project/{id}", project.getId())
                            .with(user(owner.getEmail())).session(ownerSession))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[0].checklistTotal").value(1))
                    .andExpect(jsonPath("$[0].checklistCompleted").value(0));
            for (int request = 0; request < 2; request++) {
                mvc.perform(patch(checklistItemPath, taskId, itemId).with(user(invitee.getEmail())).session(memberSession)
                                .contentType("application/json").content("{\"completed\":true}"))
                        .andExpect(status().isOk());
            }
            mvc.perform(get("/api/tasks/project/{id}", project.getId())
                            .with(user(owner.getEmail())).session(ownerSession))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[0].checklistTotal").value(1))
                    .andExpect(jsonPath("$[0].checklistCompleted").value(1));
            mvc.perform(delete(checklistItemPath, taskId, itemId).with(user(invitee.getEmail())).session(memberSession))
                    .andExpect(status().isNoContent());

            TestTransaction.start();
            mvc.perform(delete("/api/tasks/{id}", taskId).with(user(owner.getEmail())).session(ownerSession))
                    .andExpect(status().isNoContent());
            TestTransaction.flagForRollback();
            TestTransaction.end();
            assertThat(jdbc.queryForObject("""
                    select count(*) from task_activities where task_id = ? and type = 'TASK_DELETED'
                    """, Long.class, taskId)).isZero();

            mvc.perform(delete("/api/tasks/{id}", taskId).with(user(owner.getEmail())).session(ownerSession))
                    .andExpect(status().isNoContent());

            for (MvcResult stream : new MvcResult[]{ownerStream, memberStream}) {
                String content = awaitEvent(stream, "DELETED");
                assertThat(content).contains("event:task-changed", "\"projectId\":" + project.getId(),
                                "\"taskId\":" + taskId, "CREATED", "UPDATED", "STATUS_CHANGED", "DELETED")
                        .doesNotContain("\"taskId\":" + rolledBackId + ",", "private task title", "private comment body",
                                owner.getEmail(), "assigneeId", "private checklist title");
                assertThat(Pattern.compile("event:task-changed").matcher(content).results().count()).isEqualTo(8);
                assertThat(Pattern.compile("\"type\":\"CHECKLIST_CHANGED\"").matcher(content).results().count())
                        .isEqualTo(3);
                assertThat(activityEventPayloads(content)).hasSize(6)
                        .allMatch(payload -> payload.equals("{\"projectId\":" + project.getId() + "}"));
                assertThat(Pattern.compile("event:comment-changed\\s+data:\\{[^}]+}").matcher(content).results()
                        .map(event -> event.group().substring(event.group().indexOf('{'))).toList())
                        .hasSize(2)
                        .allSatisfy(payload -> {
                            assertThat(payload).contains("\"projectId\":" + project.getId(), "\"taskId\":" + taskId);
                            assertThat(payload).doesNotContain("authorId", "commentId", "content");
                        });
                assertThat(Pattern.compile("\"type\":\"UPDATED\"").matcher(content).results().count())
                        .isEqualTo(2);
            }

            members.deleteById(invitationId);
            long nextTaskId = createTask(ownerSession);
            memberStream.getAsyncResult(7000);
            assertThat(memberStream.getResponse().getContentAsString()).doesNotContain("\"taskId\":" + nextTaskId + ",");
            assertThat(activityEventPayloads(memberStream.getResponse().getContentAsString())).hasSize(6);
            assertThat(activityEventPayloads(awaitEvent(ownerStream, "\"taskId\":" + nextTaskId + ","))).hasSize(7);
            assertThat(otherStream.getResponse().getContentAsString())
                    .doesNotContain("event:task-changed", "event:comment-changed", "event:activity-changed");
            assertThat(outsiderNotifications.getResponse().getContentAsString())
                    .doesNotContain("event:notifications-changed");

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

    private java.util.List<String> activityEventPayloads(String content) {
        return Pattern.compile("event:activity-changed\\s+data:(\\{[^}]+})").matcher(content).results()
                .map(event -> event.group(1)).toList();
    }

    private ResultActions changeStatus(User actor, MockHttpSession session, long taskId, String status) throws Exception {
        return mvc.perform(patch("/api/tasks/{id}/status", taskId)
                .with(user(actor.getEmail())).session(session)
                .contentType("application/json").content("{\"status\":\"" + status + "\"}"));
    }

    private ResultActions postStreamTestComment(long taskId, MockHttpSession session) throws Exception {
        return mvc.perform(post("/api/tasks/{taskId}/comments", taskId)
                .with(user(owner.getEmail())).session(session)
                .contentType("application/json").content("{\"content\":\"private comment body\"}"));
    }

    private MvcResult openStream(Project target, User user, MockHttpSession session) throws Exception {
        return mvc.perform(get("/api/projects/{id}/events", target.getId())
                        .header("Origin", "http://localhost")
                        .with(user(user.getEmail())).session(session))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(request().asyncStarted()).andReturn();
    }

    private MvcResult openNotificationStream(User actor, MockHttpSession session) throws Exception {
        return mvc.perform(get("/api/notifications/events").header("Origin", "http://localhost")
                        .with(user(actor.getEmail())).session(session))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(request().asyncStarted()).andReturn();
    }

    private long createTask(MockHttpSession session) throws Exception {
        return createTask(session, project);
    }

    private long createTask(MockHttpSession session, Project targetProject) throws Exception {
        String response = mvc.perform(post("/api/tasks").with(user(owner.getEmail())).session(session)
                        .contentType("application/json")
                        .content("{\"projectId\":" + targetProject.getId() + ",\"title\":\"private task title\"}"))
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
