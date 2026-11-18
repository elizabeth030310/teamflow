package com.teamflow.backend.controller;

import com.teamflow.backend.entity.TaskAttachment;
import com.teamflow.backend.repository.TaskAttachmentRepository;
import com.teamflow.backend.service.AttachmentCleanupService;
import com.teamflow.backend.service.AttachmentStorage;
import com.teamflow.backend.service.AttachmentUploadService;
import com.teamflow.backend.service.ProjectAccess;
import com.teamflow.backend.service.TaskChange;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.cors.CorsUtils;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/tasks/{taskId}/attachments")
public class TaskAttachmentController {

    private final ProjectAccess access;
    private final TaskAttachmentRepository attachments;
    private final AttachmentUploadService uploads;
    private final AttachmentStorage storage;
    private final AttachmentCleanupService cleanup;
    private final ApplicationEventPublisher events;

    public TaskAttachmentController(ProjectAccess access, TaskAttachmentRepository attachments,
                                    AttachmentUploadService uploads, AttachmentStorage storage,
                                    AttachmentCleanupService cleanup, ApplicationEventPublisher events) {
        this.access = access;
        this.attachments = attachments;
        this.uploads = uploads;
        this.storage = storage;
        this.cleanup = cleanup;
        this.events = events;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public ResponseEntity<List<AttachmentResponse>> listAttachments(@PathVariable Long taskId, HttpSession session) {
        access.requireAccessibleTask(taskId, access.currentUserId(session));
        List<AttachmentResponse> response = attachments.findByTaskIdOrderByCreatedAtDescIdDesc(taskId)
                .stream().map(AttachmentResponse::from).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(response);
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<AttachmentResponse> uploadAttachment(@PathVariable Long taskId,
            @RequestParam MultiValueMap<String, MultipartFile> parts, HttpServletRequest request, HttpSession session) {
        Long userId = access.currentUserId(session);
        requireSameOrigin(request);

        List<MultipartFile> files = parts.get("file");
        if (parts.size() != 1 || files == null || files.size() != 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "첨부파일을 한 개 선택해 주세요.");
        }

        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(AttachmentResponse.from(uploads.upload(taskId, userId, files.getFirst())));
    }

    @GetMapping("/{attachmentId}/download")
    @Transactional(readOnly = true)
    public ResponseEntity<Resource> downloadAttachment(@PathVariable Long taskId, @PathVariable Long attachmentId,
                                                       HttpSession session) {
        access.requireAccessibleTask(taskId, access.currentUserId(session));
        TaskAttachment attachment = requireAttachment(taskId, attachmentId);
        Resource content = storage.download(attachment.getStorageKey());
        var disposition = ContentDisposition.attachment()
                .filename(attachment.getDisplayName(), StandardCharsets.UTF_8).build();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header("X-Content-Type-Options", "nosniff")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(attachment.getSizeBytes())
                .body(content);
    }

    @DeleteMapping("/{attachmentId}")
    @Transactional
    public ResponseEntity<Void> deleteAttachment(@PathVariable Long taskId, @PathVariable Long attachmentId,
                                                 HttpServletRequest request, HttpSession session) {
        Long userId = access.currentUserId(session);
        requireSameOrigin(request);
        var target = access.lockAccessibleTask(taskId, userId);
        TaskAttachment attachment = requireAttachment(taskId, attachmentId);
        if (!userId.equals(attachment.getUploader().getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "파일을 올린 사람만 삭제할 수 있습니다.");
        }
        cleanup.queueFile(attachment.getStorageKey());
        attachments.delete(attachment);
        events.publishEvent(new TaskChange(target.project().getId(), taskId, TaskChange.Type.ATTACHMENTS_CHANGED));
        return ResponseEntity.noContent().build();
    }

    private TaskAttachment requireAttachment(Long taskId, Long attachmentId) {
        return attachments.findByIdAndTaskId(attachmentId, taskId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "첨부파일을 찾을 수 없습니다."));
    }

    private void requireSameOrigin(HttpServletRequest request) {
        if (!isSameOrigin(request)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "같은 출처의 요청만 허용합니다.");
        }
    }

    private boolean isSameOrigin(HttpServletRequest request) {
        if (request.getHeader(HttpHeaders.ORIGIN) == null
                || "cross-site".equals(request.getHeader("Sec-Fetch-Site"))) {
            return false;
        }
        try {
            return !CorsUtils.isCorsRequest(request);
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    public record AttachmentResponse(Long id, Long uploaderId, String displayName, String contentType,
                                     long sizeBytes, Instant createdAt) {
        static AttachmentResponse from(TaskAttachment attachment) {
            return new AttachmentResponse(attachment.getId(), attachment.getUploader().getId(),
                    attachment.getDisplayName(), attachment.getContentType(),
                    attachment.getSizeBytes(), attachment.getCreatedAt());
        }
    }
}
