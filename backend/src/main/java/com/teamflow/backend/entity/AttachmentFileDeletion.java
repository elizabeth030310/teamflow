package com.teamflow.backend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "attachment_file_deletions", indexes = @Index(
        name = "idx_attachment_file_deletions_next_attempt", columnList = "next_attempt_at"))
public class AttachmentFileDeletion {

    @Id
    @Column(name = "storage_key")
    private UUID storageKey;

    @Column(name = "next_attempt_at", nullable = false)
    private Instant nextAttemptAt;

    protected AttachmentFileDeletion() {
    }

    public AttachmentFileDeletion(UUID storageKey, Instant nextAttemptAt) {
        this.storageKey = storageKey;
        this.nextAttemptAt = nextAttemptAt;
    }

    public UUID getStorageKey() {
        return storageKey;
    }

    public void retryAt(Instant nextAttemptAt) {
        this.nextAttemptAt = nextAttemptAt;
    }
}
