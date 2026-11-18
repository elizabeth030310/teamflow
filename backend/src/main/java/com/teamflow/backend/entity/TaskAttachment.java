package com.teamflow.backend.entity;

import jakarta.persistence.*;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "task_attachments",
        indexes = @Index(name = "idx_task_attachments_task_created", columnList = "task_id, created_at DESC, id DESC"),
        uniqueConstraints = @UniqueConstraint(name = "uk_task_attachments_storage_key", columnNames = "storage_key"),
        check = @CheckConstraint(name = "ck_task_attachments_size", constraint = "size_bytes > 0"))
public class TaskAttachment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_task_attachments_task"))
    @OnDelete(action = OnDeleteAction.CASCADE)
    private Task task;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "uploader_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_task_attachments_uploader"))
    private User uploader;

    @Column(name = "display_name", nullable = false, length = 255)
    private String displayName;

    @Column(name = "storage_key", nullable = false)
    private UUID storageKey;

    @Column(name = "content_type", nullable = false, length = 100)
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected TaskAttachment() {
    }

    public TaskAttachment(Task task, User uploader, String displayName, UUID storageKey,
                          String contentType, long sizeBytes, Instant createdAt) {
        this.task = task;
        this.uploader = uploader;
        this.displayName = displayName;
        this.storageKey = storageKey;
        this.contentType = contentType;
        this.sizeBytes = sizeBytes;
        this.createdAt = createdAt;
    }

    public Long getId() {
        return id;
    }

    public User getUploader() {
        return uploader;
    }

    public String getDisplayName() {
        return displayName;
    }

    public UUID getStorageKey() {
        return storageKey;
    }

    public String getContentType() {
        return contentType;
    }

    public long getSizeBytes() {
        return sizeBytes;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
