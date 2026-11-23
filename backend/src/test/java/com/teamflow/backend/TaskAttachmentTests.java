package com.teamflow.backend;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.ProjectMember;
import com.teamflow.backend.entity.Task;
import com.teamflow.backend.entity.TaskAttachment;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.AttachmentFileDeletionRepository;
import com.teamflow.backend.repository.ProjectMemberRepository;
import com.teamflow.backend.repository.ProjectRepository;
import com.teamflow.backend.repository.TaskAttachmentRepository;
import com.teamflow.backend.repository.TaskRepository;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.AttachmentCleanupService;
import com.teamflow.backend.service.AttachmentStorage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.transaction.TestTransaction;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.WebApplicationContext;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@IsolatedSpringBootTest
@Transactional
class TaskAttachmentTests {

    private static final String LIST_PATH = "/api/tasks/{taskId}/attachments";
    private static final String ATTACHMENT_PATH = LIST_PATH + "/{attachmentId}";
    private static final String SAME_ORIGIN = "http://localhost";
    private static final byte[] PDF = "%PDF-1.7\n%%EOF\n".getBytes(StandardCharsets.US_ASCII);

    @TempDir
    static Path storage;

    @DynamicPropertySource
    static void attachmentProperties(DynamicPropertyRegistry registry) {
        registry.add("teamflow.attachments.storage-root", () -> storage.toString());
        registry.add("teamflow.attachments.cleanup-delay-ms", () -> "3600000");
    }

    @Autowired private WebApplicationContext context;
    @Autowired private UserRepository users;
    @Autowired private ProjectRepository projects;
    @Autowired private ProjectMemberRepository members;
    @Autowired private TaskRepository tasks;
    @Autowired private TaskAttachmentRepository attachments;
    @Autowired private AttachmentFileDeletionRepository deletions;
    @Autowired private AttachmentCleanupService cleanup;
    @Autowired private AttachmentStorage attachmentStorage;

    private MockMvc mvc;
    private User owner;
    private Project project;
    private Task task;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity())
                .defaultRequest(get("/").header("X-TeamFlow-Request", "1")).build();
        owner = addUser("owner");
        project = new Project("Project", "Description");
        project.setOwner(owner);
        projects.save(project);
        task = addTask();
    }

    @Test
    void listRequiresAuthenticationAndAcceptedProjectAccess() throws Exception {
        User invitee = addUser("invitee");
        User outsider = addUser("outsider");
        ProjectMember invitation = members.save(new ProjectMember(project, invitee));

        mvc.perform(get(LIST_PATH, task.getId())).andExpect(status().isUnauthorized());
        mvc.perform(get(LIST_PATH, task.getId()).with(user(owner.getEmail())))
                .andExpect(status().isUnauthorized());
        list(invitee, task.getId()).andExpect(status().isNotFound());
        list(outsider, task.getId()).andExpect(status().isNotFound());
        list(owner, Long.MAX_VALUE).andExpect(status().isNotFound());
        list(owner, task.getId()).andExpect(status().isOk()).andExpect(content().json("[]"));

        invitation.respond(true);
        members.flush();
        list(invitee, task.getId()).andExpect(status().isOk()).andExpect(content().json("[]"));
    }

    @Test
    void listReturnsOnlyItsCardMetadataInNewestFirstOrder() throws Exception {
        Instant createdAt = Instant.parse("2026-01-01T00:00:00Z");
        addAttachment(task, "older.pdf", createdAt.minusSeconds(1));
        addAttachment(task, "first.pdf", createdAt);
        TaskAttachment latest = addAttachment(task, "latest.pdf", createdAt);
        addAttachment(addTask(), "different-card.pdf", createdAt.plusSeconds(1));

        list(owner, task.getId())
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].id").value(latest.getId().intValue()))
                .andExpect(jsonPath("$[0].uploaderId").value(owner.getId().intValue()))
                .andExpect(jsonPath("$[0].displayName").value("latest.pdf"))
                .andExpect(jsonPath("$[0].contentType").value("application/pdf"))
                .andExpect(jsonPath("$[0].sizeBytes").value(123))
                .andExpect(jsonPath("$[0].createdAt").value(createdAt.toString()))
                .andExpect(jsonPath("$[0].storageKey").doesNotHaveJsonPath())
                .andExpect(jsonPath("$[1].displayName").value("first.pdf"))
                .andExpect(jsonPath("$[2].displayName").value("older.pdf"));
    }

    @Test
    void removingTaskCascadesToAttachmentRows() {
        addAttachment(task, "example.pdf", Instant.now());

        tasks.delete(task);
        tasks.flush();

        assertThat(attachments.findByTaskIdOrderByCreatedAtDescIdDesc(task.getId())).isEmpty();
    }

    @Test
    void uploadStoresVerifiedBytesUnderAnInternalKeyAndCleansUpOnRollback() throws Exception {
        User member = addUser("member");
        ProjectMember invitation = members.save(new ProjectMember(project, member));
        invitation.respond(true);
        members.flush();

        mvc.perform(upload(member, uploadFile("C:\\fakepath\\road\r\nmap.PDF", "text/plain", PDF))
                        .header(HttpHeaders.ORIGIN, SAME_ORIGIN))
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.uploaderId").value(member.getId().intValue()))
                .andExpect(jsonPath("$.displayName").value("roadmap.pdf"))
                .andExpect(jsonPath("$.contentType").value("application/pdf"))
                .andExpect(jsonPath("$.sizeBytes").value(PDF.length))
                .andExpect(jsonPath("$.storageKey").doesNotHaveJsonPath());

        list(owner, task.getId()).andExpect(jsonPath("$[0].displayName").value("roadmap.pdf"));
        Path stored;
        try (var files = Files.list(storage)) {
            var paths = files.toList();
            assertThat(paths).hasSize(1);
            stored = paths.getFirst();
        }
        assertThat(stored.getFileName().toString()).matches("[0-9a-f-]{36}");
        assertThat(Files.readAllBytes(stored)).isEqualTo(PDF);

        TestTransaction.flagForRollback();
        TestTransaction.end();

        assertThat(Files.exists(stored)).isFalse();
    }

    @Test
    void uploadRequiresLoginProjectAccessAndSameOrigin() throws Exception {
        User pending = addUser("pending");
        members.save(new ProjectMember(project, pending));
        User outsider = addUser("outsider");
        MockMultipartFile file = uploadFile("report.pdf", "application/pdf", PDF);

        mvc.perform(multipart(LIST_PATH, task.getId()).file(file).header(HttpHeaders.ORIGIN, SAME_ORIGIN))
                .andExpect(status().isUnauthorized());
        mvc.perform(upload(owner, file)).andExpect(status().isForbidden());
        mvc.perform(upload(owner, file).header(HttpHeaders.ORIGIN, "https://other.example"))
                .andExpect(status().isForbidden());
        mvc.perform(upload(owner, file).header(HttpHeaders.ORIGIN, SAME_ORIGIN)
                        .header("Sec-Fetch-Site", "cross-site"))
                .andExpect(status().isForbidden());
        mvc.perform(upload(pending, file).header(HttpHeaders.ORIGIN, SAME_ORIGIN))
                .andExpect(status().isNotFound());
        mvc.perform(upload(outsider, file).header(HttpHeaders.ORIGIN, SAME_ORIGIN))
                .andExpect(status().isNotFound());

        assertNoUpload();
    }

    @Test
    void uploadRejectsEmptyMultipleOversizedAndDisguisedFiles() throws Exception {
        MockMultipartFile file = uploadFile("report.pdf", "application/pdf", PDF);
        mvc.perform(upload(owner, file).file(file).header(HttpHeaders.ORIGIN, SAME_ORIGIN))
                .andExpect(status().isBadRequest());
        mvc.perform(upload(owner, uploadFile("empty.pdf", "application/pdf", new byte[0]))
                        .header(HttpHeaders.ORIGIN, SAME_ORIGIN))
                .andExpect(status().isBadRequest());
        mvc.perform(upload(owner, uploadFile("large.pdf", "application/pdf", new byte[10 * 1024 * 1024 + 1]))
                        .header(HttpHeaders.ORIGIN, SAME_ORIGIN))
                .andExpect(status().is(413));
        mvc.perform(upload(owner, uploadFile("fake.pdf", "application/pdf", new byte[]{1, 2, 3}))
                        .header(HttpHeaders.ORIGIN, SAME_ORIGIN))
                .andExpect(status().isUnsupportedMediaType());
        mvc.perform(upload(owner, uploadFile("report.pdf.html", "application/pdf", PDF))
                        .header(HttpHeaders.ORIGIN, SAME_ORIGIN))
                .andExpect(status().isUnsupportedMediaType());

        assertNoUpload();
    }

    private MockMultipartHttpServletRequestBuilder upload(User actor, MockMultipartFile file) {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("userId", actor.getId());
        return multipart(LIST_PATH, task.getId()).file(file).with(user(actor.getEmail())).session(session);
    }

    @Test
    void downloadChecksCardAndMembershipAndReturnsSafeAttachmentHeaders() throws Exception {
        TaskAttachment attachment = addStoredAttachment(task, "한글 파일.pdf");
        User member = addUser("member");
        ProjectMember invitation = members.save(new ProjectMember(project, member));
        Task otherCard = addTask();

        mvc.perform(get(ATTACHMENT_PATH + "/download", task.getId(), attachment.getId()))
                .andExpect(status().isUnauthorized());
        download(member, task.getId(), attachment.getId()).andExpect(status().isNotFound());
        download(owner, otherCard.getId(), attachment.getId()).andExpect(status().isNotFound());

        invitation.respond(true);
        members.flush();
        var response = download(member, task.getId(), attachment.getId())
                .andExpect(status().isOk())
                .andExpect(content().bytes(PDF))
                .andExpect(content().contentType("application/octet-stream"))
                .andExpect(header().string(HttpHeaders.CONTENT_LENGTH, Integer.toString(PDF.length)))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andReturn().getResponse();
        ContentDisposition disposition = ContentDisposition.parse(response.getHeader(HttpHeaders.CONTENT_DISPOSITION));
        assertThat(disposition.isAttachment()).isTrue();
        assertThat(disposition.getFilename()).isEqualTo("한글 파일.pdf");

        TaskAttachment missing = addAttachment(task, "missing.pdf", Instant.now());
        download(owner, task.getId(), missing.getId()).andExpect(status().isNotFound());
    }

    @Test
    void onlyUploaderCanDeleteAndFileIsRemovedAfterCommit() throws Exception {
        TaskAttachment attachment = addStoredAttachment(task, "report.pdf");
        Path file = storedPath(attachment);
        User member = addUser("member");
        ProjectMember invitation = members.save(new ProjectMember(project, member));
        invitation.respond(true);
        members.flush();
        Task otherCard = addTask();
        commit();

        removeAttachment(member, task.getId(), attachment.getId(), SAME_ORIGIN)
                .andExpect(status().isForbidden());
        removeAttachment(owner, otherCard.getId(), attachment.getId(), SAME_ORIGIN)
                .andExpect(status().isNotFound());
        removeAttachment(owner, task.getId(), attachment.getId(), "https://other.example")
                .andExpect(status().isForbidden());

        TestTransaction.start();
        removeAttachment(owner, task.getId(), attachment.getId(), SAME_ORIGIN)
                .andExpect(status().isNoContent());

        cleanup.removeQueuedFiles();
        assertThat(file).exists();
        commit();

        download(owner, task.getId(), attachment.getId()).andExpect(status().isNotFound());
        assertThat(deletions.existsById(attachment.getStorageKey())).isTrue();
        cleanup.removeQueuedFiles();
        assertThat(file).doesNotExist();
        assertThat(deletions.existsById(attachment.getStorageKey())).isFalse();
    }

    @Test
    void removingCardAndProjectQueuesAllOfTheirAttachmentFiles() throws Exception {
        TaskAttachment cardAttachment = addStoredAttachment(task, "card.pdf");
        TaskAttachment projectAttachment = addStoredAttachment(addTask(), "project.pdf");

        mvc.perform(delete("/api/tasks/{taskId}", task.getId())
                        .with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isNoContent());
        mvc.perform(delete("/api/projects/{projectId}", project.getId())
                        .with(user(owner.getEmail())).session(session(owner)))
                .andExpect(status().isNoContent());
        commit();

        for (TaskAttachment attachment : new TaskAttachment[]{cardAttachment, projectAttachment}) {
            assertThat(attachments.existsById(attachment.getId())).isFalse();
            assertThat(deletions.existsById(attachment.getStorageKey())).isTrue();
            assertThat(storedPath(attachment)).exists();
        }
        cleanup.removeQueuedFiles();
        assertThat(storedPath(cardAttachment)).doesNotExist();
        assertThat(storedPath(projectAttachment)).doesNotExist();
        assertThat(deletions.existsById(cardAttachment.getStorageKey())).isFalse();
        assertThat(deletions.existsById(projectAttachment.getStorageKey())).isFalse();
    }

    @Test
    void rolledBackRemovalKeepsFileAndFailedCleanupCanRetry() throws Exception {
        TaskAttachment attachment = addStoredAttachment(task, "retry.pdf");
        Path file = storedPath(attachment);
        commit();

        TestTransaction.start();
        removeAttachment(owner, task.getId(), attachment.getId(), SAME_ORIGIN)
                .andExpect(status().isNoContent());
        TestTransaction.flagForRollback();
        TestTransaction.end();
        assertThat(file).exists();
        assertThat(deletions.existsById(attachment.getStorageKey())).isFalse();
        download(owner, task.getId(), attachment.getId()).andExpect(status().isOk());

        removeAttachment(owner, task.getId(), attachment.getId(), SAME_ORIGIN)
                .andExpect(status().isNoContent());
        Files.delete(file);
        Files.createDirectory(file);
        cleanup.removeQueuedFiles();
        assertThat(file).isDirectory();
        assertThat(deletions.existsById(attachment.getStorageKey())).isTrue();
        assertThat(deletions.findTop100ByNextAttemptAtLessThanEqualOrderByNextAttemptAtAsc(Instant.now()))
                .noneMatch(entry -> entry.getStorageKey().equals(attachment.getStorageKey()));

        Files.delete(file);
        var retry = deletions.findById(attachment.getStorageKey()).orElseThrow();
        retry.retryAt(Instant.now().minusSeconds(1));
        deletions.save(retry);
        cleanup.removeQueuedFiles();
        assertThat(deletions.existsById(attachment.getStorageKey())).isFalse();
    }

    @Test
    void attachmentEventsReachProjectMembersOnlyAfterCommit() throws Exception {
        User member = addUser("member");
        ProjectMember invitation = members.save(new ProjectMember(project, member));
        invitation.respond(true);
        Project unrelated = new Project("Unrelated", "Description");
        unrelated.setOwner(member);
        projects.save(unrelated);
        commit();

        MockHttpSession memberSession = session(member);
        try {
            MvcResult stream = subscribe(member, memberSession, project.getId());
            MvcResult otherStream = subscribe(member, memberSession, unrelated.getId());

            TestTransaction.start();
            uploadPdf("rolled-back.pdf").andExpect(status().isCreated());
            TestTransaction.flagForRollback();
            TestTransaction.end();

            uploadPdf("committed.pdf").andExpect(status().isCreated());
            Long attachmentId = attachments.findByTaskIdOrderByCreatedAtDescIdDesc(task.getId()).getFirst().getId();
            removeAttachment(owner, task.getId(), attachmentId, SAME_ORIGIN).andExpect(status().isNoContent());

            String content = awaitAttachmentEvents(stream, 2);
            String payload = "data:{\"projectId\":" + project.getId() + ",\"taskId\":" + task.getId()
                    + ",\"type\":\"ATTACHMENTS_CHANGED\"}";
            assertThat(content.lines().filter(line -> line.startsWith("data:")).toList())
                    .containsExactly(payload, payload);
            assertThat(content.lines().filter("event:task-changed"::equals).count()).isEqualTo(2);
            assertThat(otherStream.getResponse().getContentAsString()).doesNotContain("ATTACHMENTS_CHANGED");
            cleanup.removeQueuedFiles();
        } finally {
            memberSession.invalidate();
        }
    }

    private MvcResult subscribe(User actor, MockHttpSession actorSession, Long projectId) throws Exception {
        return mvc.perform(get("/api/projects/{projectId}/events", projectId)
                        .with(user(actor.getEmail())).session(actorSession))
                .andExpect(status().isOk()).andExpect(request().asyncStarted()).andReturn();
    }

    private ResultActions uploadPdf(String name) throws Exception {
        return mvc.perform(upload(owner, uploadFile(name, "application/pdf", PDF))
                .header(HttpHeaders.ORIGIN, SAME_ORIGIN));
    }

    private String awaitAttachmentEvents(MvcResult stream, long count) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(6);
        String content;
        do {
            content = stream.getResponse().getContentAsString();
            if (content.lines().filter(line -> line.contains("ATTACHMENTS_CHANGED")).count() >= count) {
                return content;
            }
            Thread.sleep(50);
        } while (System.nanoTime() < deadline);
        return content;
    }

    private ResultActions download(User actor, Long taskId, Long attachmentId) throws Exception {
        return mvc.perform(get(ATTACHMENT_PATH + "/download", taskId, attachmentId)
                .with(user(actor.getEmail())).session(session(actor)));
    }

    private ResultActions removeAttachment(User actor, Long taskId, Long attachmentId, String origin) throws Exception {
        return mvc.perform(delete(ATTACHMENT_PATH, taskId, attachmentId).header(HttpHeaders.ORIGIN, origin)
                .with(user(actor.getEmail())).session(session(actor)));
    }

    private TaskAttachment addStoredAttachment(Task target, String displayName) throws Exception {
        UUID key = UUID.randomUUID();
        attachmentStorage.write(key, new ByteArrayInputStream(PDF));
        return attachments.save(new TaskAttachment(target, owner, displayName, key,
                "application/pdf", PDF.length, Instant.now()));
    }

    private Path storedPath(TaskAttachment attachment) {
        return storage.resolve(attachment.getStorageKey().toString());
    }

    private void commit() {
        TestTransaction.flagForCommit();
        TestTransaction.end();
    }

    private MockMultipartFile uploadFile(String name, String contentType, byte[] content) {
        return new MockMultipartFile("file", name, contentType, content);
    }

    private void assertNoUpload() throws Exception {
        list(owner, task.getId()).andExpect(content().json("[]"));
        try (var files = Files.list(storage)) {
            assertThat(files.toList()).isEmpty();
        }
    }

    private ResultActions list(User actor, Long taskId) throws Exception {
        return mvc.perform(get(LIST_PATH, taskId).with(user(actor.getEmail())).session(session(actor)));
    }

    private MockHttpSession session(User actor) {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("userId", actor.getId());
        return session;
    }

    private User addUser(String name) {
        return users.save(new User(name, name + "-" + UUID.randomUUID() + "@example.test", "unused"));
    }

    private Task addTask() {
        return tasks.save(new Task(project.getId(), "Task", "Description", "TODO"));
    }

    private TaskAttachment addAttachment(Task target, String displayName, Instant createdAt) {
        return attachments.save(new TaskAttachment(target, owner, displayName, UUID.randomUUID(),
                "application/pdf", 123, createdAt));
    }
}
