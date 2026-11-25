package com.teamflow.backend.service;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Objects;

@Service
public class NotificationService {
    private static final int PAGE_SIZE = 30;
    private static final ZoneId DEADLINE_ZONE = ZoneId.of("Asia/Seoul");
    private static final String CAN_ACCESS = """
            (projects.owner_id = recipient.user_id OR EXISTS (
                SELECT 1 FROM project_members
                WHERE project_id = projects.id AND user_id = recipient.user_id AND status = 'ACCEPTED'
            ))
            """;
    private static final String VISIBLE = """
            FROM notifications
            LEFT JOIN tasks ON tasks.id = notifications.task_id
            LEFT JOIN project_members invitation ON invitation.id = notifications.invitation_id
            JOIN projects ON projects.id = COALESCE(tasks.project_id, invitation.project_id)
            CROSS JOIN LATERAL (SELECT notifications.recipient_id AS user_id) recipient
            WHERE recipient.user_id = ? AND (
                (invitation.id IS NOT NULL AND invitation.user_id = recipient.user_id
                    AND invitation.status = 'PENDING')
                OR (tasks.id IS NOT NULL AND
            """ + CAN_ACCESS + "))";

    private final JdbcTemplate jdbc;
    private final ApplicationEventPublisher events;

    public NotificationService(JdbcTemplate jdbc, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    public record Changed(Long userId) {}

    public record Item(long id, long projectId, Long taskId, String taskTitle, String kind,
                       LocalDate dueDate, Instant createdAt, boolean read,
                       String actorName, Long parentCommentId, Long replyCommentId, String projectName) {}

    public record Inbox(List<Item> items, long unreadCount, boolean hasMore) {}

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Inbox inbox(Long userId, int page) {
        long unread = jdbc.queryForObject("SELECT count(*) " + VISIBLE + " AND read_at IS NULL",
                Long.class, userId);
        List<Item> items = jdbc.query("""
                SELECT notifications.id, projects.id AS project_id, tasks.id AS task_id, tasks.title,
                       CASE WHEN invitation.id IS NOT NULL THEN projects.name END AS project_name,
                       kind, notifications.due_date, notifications.created_at, read_at IS NOT NULL AS is_read,
                       actor_name, parent_comment_id, reply_comment_id
                """ + VISIBLE + " ORDER BY notifications.created_at DESC, notifications.id DESC LIMIT ? OFFSET ?",
                (row, index) -> new Item(row.getLong("id"), row.getLong("project_id"),
                        row.getObject("task_id", Long.class), row.getString("title"), row.getString("kind"),
                        row.getObject("due_date", LocalDate.class), row.getTimestamp("created_at").toInstant(),
                        row.getBoolean("is_read"), row.getString("actor_name"),
                        row.getObject("parent_comment_id", Long.class), row.getObject("reply_comment_id", Long.class),
                        row.getString("project_name")),
                userId, PAGE_SIZE + 1, (long) page * PAGE_SIZE);
        return new Inbox(items.stream().limit(PAGE_SIZE).toList(), unread, items.size() > PAGE_SIZE);
    }

    public boolean publishInvitation(Long invitationId, Long recipientId) {
        int changed = jdbc.update("""
                INSERT INTO notifications (recipient_id, invitation_id, kind, created_at)
                VALUES (?, ?, 'PROJECT_INVITATION', statement_timestamp())
                ON CONFLICT (invitation_id) DO UPDATE
                SET created_at = EXCLUDED.created_at, read_at = NULL
                WHERE notifications.created_at <= EXCLUDED.created_at - INTERVAL '1 minute'
                """, recipientId, invitationId);
        if (changed > 0) {
            invitationChanged(recipientId);
        }
        return changed > 0;
    }

    public void invitationChanged(Long recipientId) {
        events.publishEvent(new Changed(recipientId));
    }

    public void assigned(Long taskId, Long assigneeId, Long actorId) {
        if (assigneeId != null && !Objects.equals(assigneeId, actorId)) {
            jdbc.update("INSERT INTO notifications (recipient_id, task_id, kind) VALUES (?, ?, 'ASSIGNMENT')",
                    assigneeId, taskId);
            events.publishEvent(new Changed(assigneeId));
        }
    }

    public void commented(Long taskId, Long actorId) {
        publishChanges(jdbc.queryForList("""
                INSERT INTO notifications (recipient_id, task_id, kind)
                SELECT recipient.user_id, tasks.id, 'COMMENT'
                FROM tasks JOIN projects ON projects.id = tasks.project_id
                CROSS JOIN LATERAL (
                    SELECT projects.owner_id AS user_id
                    UNION SELECT tasks.assignee_id
                    UNION SELECT author_id FROM task_comments WHERE task_id = tasks.id AND NOT deleted
                ) recipient
                WHERE tasks.id = ? AND recipient.user_id <> ? AND
                """ + CAN_ACCESS + " RETURNING recipient_id", Long.class, taskId, actorId));
    }

    public void replied(Long taskId, Long parentAuthorId, Long actorId, String actorName,
                        Long parentCommentId, Long replyCommentId) {
        if (Objects.equals(parentAuthorId, actorId)) {
            return;
        }
        publishChanges(jdbc.queryForList("""
                INSERT INTO notifications (recipient_id, task_id, kind, actor_name, parent_comment_id, reply_comment_id)
                SELECT recipient.user_id, tasks.id, 'COMMENT_REPLY', ?, ?, ?
                FROM tasks JOIN projects ON projects.id = tasks.project_id
                CROSS JOIN LATERAL (SELECT CAST(? AS BIGINT) AS user_id) recipient
                WHERE tasks.id = ? AND
                """ + CAN_ACCESS + " RETURNING recipient_id", Long.class,
                actorName, parentCommentId, replyCommentId, parentAuthorId, taskId));
    }

    @Scheduled(initialDelay = 10000, fixedDelay = 60000)
    @Transactional
    public void checkDeadlines() {
        generateDeadlines(LocalDate.now(DEADLINE_ZONE));
    }

    @Transactional
    public void generateDeadlines(LocalDate today) {
        publishChanges(jdbc.queryForList("""
                WITH inserted AS (
                    INSERT INTO notifications (recipient_id, task_id, kind, due_date)
                    SELECT recipient.user_id, tasks.id,
                           CASE WHEN tasks.due_date < ? THEN 'OVERDUE' ELSE 'DUE_SOON' END, tasks.due_date
                    FROM tasks JOIN projects ON projects.id = tasks.project_id
                    CROSS JOIN LATERAL (SELECT COALESCE(tasks.assignee_id, projects.owner_id) AS user_id) recipient
                    WHERE tasks.due_date <= ? AND tasks.status IN ('TODO', 'IN_PROGRESS')
                      AND recipient.user_id IS NOT NULL AND
                """ + CAN_ACCESS + """
                    ON CONFLICT (recipient_id, task_id, kind, due_date) DO NOTHING
                    RETURNING recipient_id
                )
                SELECT DISTINCT recipient_id FROM inserted
                """, Long.class, today, today.plusDays(3)));
    }

    @Transactional
    public boolean markRead(Long userId, long id) {
        int changed = jdbc.update("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id IN ("
                + "SELECT notifications.id " + VISIBLE + " AND notifications.id = ?) AND read_at IS NULL",
                userId, id);
        if (changed > 0) {
            events.publishEvent(new Changed(userId));
            return true;
        }
        return jdbc.queryForObject("SELECT EXISTS (SELECT 1 " + VISIBLE + " AND notifications.id = ?)",
                Boolean.class, userId, id);
    }

    @Transactional
    public void markAllRead(Long userId) {
        int changed = jdbc.update("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id IN ("
                + "SELECT notifications.id " + VISIBLE + ") AND read_at IS NULL", userId);
        if (changed > 0) {
            events.publishEvent(new Changed(userId));
        }
    }

    private void publishChanges(List<Long> recipients) {
        recipients.forEach(userId -> events.publishEvent(new Changed(userId)));
    }
}
