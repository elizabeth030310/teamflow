package com.teamflow.backend.service;

import com.teamflow.backend.entity.AttachmentFileDeletion;
import com.teamflow.backend.repository.AttachmentFileDeletionRepository;
import com.teamflow.backend.repository.TaskAttachmentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class AttachmentCleanupService {

    private static final Logger log = LoggerFactory.getLogger(AttachmentCleanupService.class);
    private static final long RETRY_DELAY_SECONDS = 60;

    private final AttachmentStorage storage;
    private final TaskAttachmentRepository attachments;
    private final AttachmentFileDeletionRepository deletions;

    public AttachmentCleanupService(AttachmentStorage storage, TaskAttachmentRepository attachments,
                                    AttachmentFileDeletionRepository deletions) {
        this.storage = storage;
        this.attachments = attachments;
        this.deletions = deletions;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void queueFile(UUID storageKey) {
        deletions.save(new AttachmentFileDeletion(storageKey, Instant.now()));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void queueTaskFiles(Long taskId) {
        enqueue(attachments.findStorageKeysByTaskId(taskId));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void queueAndDeleteProjectAttachments(Long projectId) {
        List<UUID> storageKeys = attachments.findStorageKeysByProjectId(projectId);
        if (!storageKeys.isEmpty()) {
            enqueue(storageKeys);
            attachments.deleteAllByProjectId(projectId);
        }
    }

    @Scheduled(fixedDelayString = "${teamflow.attachments.cleanup-delay-ms:10000}",
            initialDelayString = "${teamflow.attachments.cleanup-delay-ms:10000}")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void removeQueuedFiles() {
        if (!storage.isConfigured()) {
            return;
        }
        var ready = deletions.findTop100ByNextAttemptAtLessThanEqualOrderByNextAttemptAtAsc(Instant.now());
        for (AttachmentFileDeletion deletion : ready) {
            try {
                storage.delete(deletion.getStorageKey());
                deletions.delete(deletion);
            } catch (IOException exception) {
                deletion.retryAt(Instant.now().plusSeconds(RETRY_DELAY_SECONDS));
                log.warn("Failed to remove attachment {}; will retry", deletion.getStorageKey(), exception);
            }
        }
    }

    private void enqueue(List<UUID> storageKeys) {
        Instant now = Instant.now();
        deletions.saveAll(storageKeys.stream().map(key -> new AttachmentFileDeletion(key, now)).toList());
    }
}
