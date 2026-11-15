package com.teamflow.backend.entity;

import jakarta.persistence.*;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

import java.time.Instant;

@Entity
@Table(name = "task_activities", indexes = @Index(
        name = "idx_task_activities_project_created", columnList = "project_id, created_at, id"))
public class TaskActivity {

    public enum Type {
        TASK_CREATED,
        TASK_STATUS_CHANGED,
        TASK_ASSIGNEE_CHANGED,
        COMMENT_CREATED,
        COMMENT_DELETED,
        TASK_DELETED
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "project_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private Project project;

    @Column(nullable = false)
    private Long taskId;

    @Column(nullable = false)
    private String taskTitle;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Type type;

    @Column(length = 20)
    private String previousStatus;

    @Column(length = 20)
    private String newStatus;

    private Long previousAssigneeId;

    private Long newAssigneeId;

    @Column(nullable = false)
    private Long actorId;

    @Column(nullable = false, length = 50)
    private String actorName;

    @Column(nullable = false)
    private Instant createdAt;

    protected TaskActivity() {
    }

    public Long getProjectId() {
        return project.getId();
    }

    public static TaskActivity created(Project project, Task task, User actor) {
        return new TaskActivity(project, task, actor, Type.TASK_CREATED);
    }

    public static TaskActivity statusChanged(Project project, Task task, User actor, String previousStatus) {
        TaskActivity activity = new TaskActivity(project, task, actor, Type.TASK_STATUS_CHANGED);
        activity.previousStatus = previousStatus;
        activity.newStatus = task.getStatus();
        return activity;
    }

    public static TaskActivity assigneeChanged(Project project, Task task, User actor, Long previousAssigneeId) {
        TaskActivity activity = new TaskActivity(project, task, actor, Type.TASK_ASSIGNEE_CHANGED);
        activity.previousAssigneeId = previousAssigneeId;
        activity.newAssigneeId = task.getAssigneeId();
        return activity;
    }

    public static TaskActivity commentCreated(Project project, Task task, User actor) {
        return new TaskActivity(project, task, actor, Type.COMMENT_CREATED);
    }

    public static TaskActivity commentDeleted(Project project, Task task, User actor) {
        return new TaskActivity(project, task, actor, Type.COMMENT_DELETED);
    }

    public static TaskActivity deleted(Project project, Task task, User actor) {
        return new TaskActivity(project, task, actor, Type.TASK_DELETED);
    }

    private TaskActivity(Project project, Task task, User actor, Type type) {
        this.project = project;
        this.taskId = task.getId();
        this.taskTitle = task.getTitle();
        this.type = type;
        this.actorId = actor.getId();
        this.actorName = actor.getName();
        this.createdAt = Instant.now();
    }
}
