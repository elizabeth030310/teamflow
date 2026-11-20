package com.teamflow.backend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.ColumnDefault;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

import java.time.Instant;

@Entity
@Table(name = "task_comments", indexes = {
        @Index(name = "idx_task_comments_task_created", columnList = "task_id, created_at, id"),
        @Index(name = "idx_task_comments_parent", columnList = "parent_comment_id")
})
public class TaskComment {

    public static final int MAX_CONTENT_LENGTH = 1000;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private Task task;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "author_id", nullable = false)
    private User author;

    @Column(name = "parent_comment_id", updatable = false)
    private Long parentCommentId;

    @Column(nullable = false)
    @ColumnDefault("false")
    private boolean deleted;

    @Column(nullable = false, length = MAX_CONTENT_LENGTH)
    private String content;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected TaskComment() {
    }

    public TaskComment(Task task, User author, String content, Long parentCommentId) {
        this.task = task;
        this.author = author;
        this.content = content;
        this.parentCommentId = parentCommentId;
        this.createdAt = Instant.now();
    }

    public void edit(String content) {
        this.content = content;
    }

    public void removeContent() {
        deleted = true;
        content = "";
    }

    public Long getParentCommentId() {
        return parentCommentId;
    }

    public boolean isDeleted() {
        return deleted;
    }

    public Long getId() {
        return id;
    }

    public Task getTask() {
        return task;
    }

    public User getAuthor() {
        return author;
    }

    public String getContent() {
        return content;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
