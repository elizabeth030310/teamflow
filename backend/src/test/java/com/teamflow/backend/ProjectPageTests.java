package com.teamflow.backend;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.ProjectMember;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.ProjectMemberRepository;
import com.teamflow.backend.repository.ProjectRepository;
import com.teamflow.backend.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@IsolatedSpringBootTest
@Sql(scripts = {"file:db/193-a-project-pages.sql", "file:db/193-d-project-page-content-format.sql"},
        executionPhase = Sql.ExecutionPhase.BEFORE_TEST_CLASS)
@Transactional
class ProjectPageTests {

    @Autowired private WebApplicationContext context;
    @Autowired private UserRepository users;
    @Autowired private ProjectRepository projects;
    @Autowired private ProjectMemberRepository members;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private ObjectMapper json;

    private MockMvc mvc;
    private User owner;
    private Project project;
    private String pages;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        owner = addUser("owner");
        project = addProject();
        pages = "/api/projects/" + project.getId() + "/pages";
    }

    @Test
    void createsReadsMovesAndDeletesPages() throws Exception {
        long root = create(owner, "Root", null);
        long child = create(owner, "Child", root);
        long grandchild = create(owner, "Grandchild", child);

        mvc.perform(as(get(pages), owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(root));
        mvc.perform(as(get(pages + "/{id}/children", root), owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(child));
        mvc.perform(as(get(pages + "/tree"), owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$[2].id").value(grandchild))
                .andExpect(jsonPath("$[2].depth").value(2))
                .andExpect(jsonPath("$[2].content").doesNotExist());
        mvc.perform(as(delete(pages + "/{id}", root), owner)).andExpect(status().isConflict());
        mvc.perform(as(put(pages + "/{id}", child), owner).contentType("application/json")
                        .content("""
                                {"title":"  Renamed  ","content":"# Notes","parentPageId":null}
                                """))
                .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("Renamed"))
                .andExpect(jsonPath("$.parentPageId").value(nullValue()));
        mvc.perform(as(get(pages + "/{id}", child), owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("# Notes"));

        for (long pageId : new long[]{root, grandchild, child}) {
            mvc.perform(as(delete(pages + "/{id}", pageId), owner)).andExpect(status().isNoContent());
            mvc.perform(as(get(pages + "/{id}", pageId), owner)).andExpect(status().isNotFound());
        }
    }

    @Test
    void retainsPlainContentAndSavesLargerRichContentWithRevisionCheck() throws Exception {
        String legacy = "  첫 줄\r\n\n<em>본문</em>\n";
        jdbc.update("INSERT INTO project_pages (project_id, title, content) VALUES (?, ?, ?)",
                project.getId(), "Legacy", legacy);
        long pageId = jdbc.queryForObject("SELECT id FROM project_pages WHERE project_id = ? AND title = 'Legacy'",
                Long.class, project.getId());
        String snapshot = mvc.perform(as(get(pages + "/{id}", pageId), owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value(legacy))
                .andExpect(jsonPath("$.contentFormat").value("plain"))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        String revision = json.readTree(snapshot).get("updatedAt").asString();
        String rich = json.writeValueAsString(Map.of("type", "doc", "content", java.util.List.of(
                Map.of("type", "paragraph", "content", java.util.List.of(
                        Map.of("type", "text", "text", "x".repeat(100000)))))));
        String update = json.writeValueAsString(Map.of("title", "Legacy", "content", rich,
                "contentFormat", "rich-v1", "expectedUpdatedAt", revision));
        mvc.perform(as(put(pages + "/{id}", pageId), owner).contentType("application/json").content(update))
                .andExpect(status().isOk()).andExpect(jsonPath("$.contentFormat").value("rich-v1"));
        mvc.perform(as(put(pages + "/{id}", pageId), owner).contentType("application/json").content(update))
                .andExpect(status().isConflict());
        mvc.perform(as(get(pages + "/{id}", pageId), owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value(rich));
    }

    @Test
    void requiresAnActiveProjectOwnerOrAcceptedMember() throws Exception {
        User member = addUser("member");
        User outsider = addUser("outsider");
        ProjectMember invitation = members.save(new ProjectMember(project, member));

        mvc.perform(get(pages)).andExpect(status().isUnauthorized());
        mvc.perform(as(get(pages + "/tree"), outsider)).andExpect(status().isNotFound());
        mvc.perform(as(post(pages), member).contentType("application/json").content(body("Pending", null)))
                .andExpect(status().isNotFound());

        invitation.respond(true);
        members.flush();
        long page = create(member, "Member page", null);
        mvc.perform(as(put(pages + "/{id}", page), outsider).contentType("application/json")
                        .content(body("Unauthorized", null))).andExpect(status().isNotFound());
        mvc.perform(as(delete(pages + "/{id}", page), outsider)).andExpect(status().isNotFound());
        members.delete(invitation);
        members.flush();
        mvc.perform(as(get(pages + "/{id}", page), member)).andExpect(status().isNotFound());
        mvc.perform(as(get(pages + "/{id}", page), owner)).andExpect(status().isOk());
    }

    @Test
    void rejectsInvalidInputCyclesAndCrossProjectParents() throws Exception {
        long root = create(owner, "Root", null);
        long child = create(owner, "Child", root);
        long grandchild = create(owner, "Grandchild", child);
        Project another = addProject();
        String otherPages = "/api/projects/" + another.getId() + "/pages";

        for (long invalidParent : new long[]{root, grandchild, Long.MAX_VALUE}) {
            mvc.perform(as(put(pages + "/{id}", root), owner).contentType("application/json")
                            .content(body("Root", invalidParent))).andExpect(status().isBadRequest());
        }
        for (String invalid : new String[]{
                "{}", body("   ", null), body("x".repeat(201), null), body("Valid", 0L),
                "{\"title\":\"Valid\",\"content\":\"%s\"}".formatted("x".repeat(100001)),
                "{\"title\":\"Valid\",\"content\":\"\\u0000\"}"}) {
            mvc.perform(as(post(pages), owner).contentType("application/json").content(invalid))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(as(post(otherPages), owner).contentType("application/json").content(body("Foreign", child)))
                .andExpect(status().isBadRequest());
        mvc.perform(as(get(otherPages + "/{id}", child), owner)).andExpect(status().isNotFound());
        mvc.perform(as(get(pages + "/tree"), owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(root))
                .andExpect(jsonPath("$[1].parentPageId").value(root))
                .andExpect(jsonPath("$[2].parentPageId").value(child));
    }

    @Test
    void deletingProjectRemovesItsWholePageTree() throws Exception {
        long root = create(owner, "Root", null);
        create(owner, "Child", root);

        mvc.perform(as(delete("/api/projects/{id}", project.getId()), owner)).andExpect(status().isNoContent());
        projects.flush();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM project_pages WHERE project_id = ?",
                Long.class, project.getId())).isZero();
    }

    private long create(User actor, String title, Long parent) throws Exception {
        mvc.perform(as(post(pages), actor).contentType("application/json").content(body(title, parent)))
                .andExpect(status().isCreated());
        return jdbc.queryForObject("SELECT id FROM project_pages WHERE project_id = ? AND title = ?",
                Long.class, project.getId(), title);
    }

    private static String body(String title, Long parent) {
        return """
                {"title":"%s","parentPageId":%s}
                """.formatted(title, parent);
    }

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request, User actor) {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("userId", actor.getId());
        return request.session(session).with(user(actor.getEmail()));
    }

    private User addUser(String name) {
        return users.save(new User(name, name + "-" + UUID.randomUUID() + "@example.test", "unused"));
    }

    private Project addProject() {
        Project result = new Project("Pages", "");
        result.setOwner(owner);
        return projects.save(result);
    }
}
