package com.teamflow.backend.repository;

import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public class ProjectPageRepository {

    private static final String PAGE_COLUMNS = "id, project_id, parent_page_id, title, content, created_at, updated_at";
    private static final RowMapper<Page> PAGE_MAPPER = (row, index) -> new Page(
            row.getLong("id"), row.getLong("project_id"), row.getObject("parent_page_id", Long.class),
            row.getString("title"), row.getString("content"), row.getObject("created_at", OffsetDateTime.class),
            row.getObject("updated_at", OffsetDateTime.class));
    private static final RowMapper<PageSummary> SUMMARY_MAPPER = (row, index) -> new PageSummary(
            row.getLong("id"), row.getObject("parent_page_id", Long.class), row.getString("title"));

    private final JdbcClient jdbc;

    public ProjectPageRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Page> find(long projectId, long pageId) {
        return jdbc.sql("SELECT " + PAGE_COLUMNS + " FROM project_pages WHERE project_id = ? AND id = ?")
                .params(projectId, pageId).query(PAGE_MAPPER).optional();
    }

    public List<PageSummary> children(long projectId, Long parentPageId) {
        String parentFilter = parentPageId == null ? "parent_page_id IS NULL" : "parent_page_id = :parentPageId";
        var query = jdbc.sql("""
                SELECT id, parent_page_id, title FROM project_pages WHERE project_id = :projectId AND
                """ + parentFilter + " ORDER BY id").param("projectId", projectId);
        if (parentPageId != null) {
            query.param("parentPageId", parentPageId);
        }
        return query.query(SUMMARY_MAPPER).list();
    }

    public List<TreeEntry> tree(long projectId) {
        return jdbc.sql("""
                WITH RECURSIVE tree AS (
                    SELECT id, parent_page_id, title, 0 AS depth, ARRAY[id] AS path
                    FROM project_pages WHERE project_id = :projectId AND parent_page_id IS NULL
                    UNION ALL
                    SELECT child.id, child.parent_page_id, child.title, tree.depth + 1, tree.path || child.id
                    FROM project_pages child JOIN tree ON child.parent_page_id = tree.id
                    WHERE child.project_id = :projectId
                )
                SELECT id, parent_page_id, title, depth FROM tree ORDER BY path
                """).param("projectId", projectId).query((row, index) -> new TreeEntry(row.getLong("id"),
                row.getObject("parent_page_id", Long.class), row.getString("title"), row.getInt("depth"))).list();
    }

    public boolean wouldCycle(long projectId, long pageId, long parentPageId) {
        return jdbc.sql("""
                WITH RECURSIVE ancestors AS (
                    SELECT id, parent_page_id FROM project_pages WHERE project_id = :projectId AND id = :parentPageId
                    UNION
                    SELECT parent.id, parent.parent_page_id
                    FROM project_pages parent JOIN ancestors ON parent.id = ancestors.parent_page_id
                    WHERE parent.project_id = :projectId
                )
                SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = :pageId)
                """).param("projectId", projectId).param("parentPageId", parentPageId)
                .param("pageId", pageId).query(Boolean.class).single();
    }

    public boolean hasChildren(long projectId, long pageId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM project_pages WHERE project_id = ? AND parent_page_id = ?)")
                .params(projectId, pageId).query(Boolean.class).single();
    }

    public Page create(long projectId, Long parentPageId, String title, String content) {
        return jdbc.sql("""
                INSERT INTO project_pages (project_id, parent_page_id, title, content)
                VALUES (:projectId, :parentPageId, :title, :content) RETURNING
                """ + PAGE_COLUMNS).param("projectId", projectId).param("parentPageId", parentPageId)
                .param("title", title).param("content", content).query(PAGE_MAPPER).single();
    }

    public Page update(long projectId, long pageId, Long parentPageId, String title, String content) {
        return jdbc.sql("""
                UPDATE project_pages SET parent_page_id = :parentPageId, title = :title, content = :content,
                    updated_at = clock_timestamp()
                WHERE project_id = :projectId AND id = :pageId RETURNING
                """ + PAGE_COLUMNS).param("projectId", projectId).param("pageId", pageId)
                .param("parentPageId", parentPageId).param("title", title).param("content", content)
                .query(PAGE_MAPPER).single();
    }

    public void delete(long projectId, long pageId) {
        jdbc.sql("DELETE FROM project_pages WHERE project_id = ? AND id = ?").params(projectId, pageId).update();
    }

    public record Page(long id, long projectId, Long parentPageId, String title, String content,
                       OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    public record PageSummary(long id, Long parentPageId, String title) {
    }

    public record TreeEntry(long id, Long parentPageId, String title, int depth) {
    }
}
