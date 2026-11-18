package com.teamflow.backend.service;

public record TaskChange(Long projectId, Long taskId, Type type) {
    public enum Type {
        CREATED, UPDATED, STATUS_CHANGED, DELETED, CHECKLIST_CHANGED, ATTACHMENTS_CHANGED
    }
}
