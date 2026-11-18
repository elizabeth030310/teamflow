package com.teamflow.backend.service;

import com.teamflow.backend.entity.TaskAttachment;
import com.teamflow.backend.repository.TaskAttachmentRepository;
import com.teamflow.backend.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.text.Normalizer;
import java.time.Instant;
import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;

@Service
public class AttachmentUploadService {

    private static final Logger log = LoggerFactory.getLogger(AttachmentUploadService.class);
    private static final long MAX_FILE_SIZE = 10L * 1024 * 1024;
    private static final int MAX_DISPLAY_NAME_LENGTH = 255;
    private static final int SIGNATURE_BYTES = 8;

    private final ProjectAccess access;
    private final TaskAttachmentRepository attachments;
    private final UserRepository users;
    private final AttachmentStorage storage;
    private final ApplicationEventPublisher events;

    public AttachmentUploadService(ProjectAccess access, TaskAttachmentRepository attachments, UserRepository users,
                                   AttachmentStorage storage, ApplicationEventPublisher events) {
        this.access = access;
        this.attachments = attachments;
        this.users = users;
        this.storage = storage;
        this.events = events;
    }

    @Transactional
    public TaskAttachment upload(Long taskId, Long userId, MultipartFile file) {
        var task = access.lockAccessibleTask(taskId, userId).task();
        storage.requireConfigured();
        if (file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "빈 파일은 첨부할 수 없습니다.");
        }
        if (file.getSize() > MAX_FILE_SIZE) {
            throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "파일은 10 MiB 이하여야 합니다.");
        }

        String name = sanitizeName(file.getOriginalFilename());
        int extensionStart = name.lastIndexOf('.');
        String extension = extensionStart > 0 ? name.substring(extensionStart).toLowerCase(Locale.ROOT) : "";
        UUID storageKey = UUID.randomUUID();
        FileFormat format;
        try (var content = new BufferedInputStream(file.getInputStream())) {
            content.mark(SIGNATURE_BYTES);
            format = FileFormat.detect(extension, content.readNBytes(SIGNATURE_BYTES));
            content.reset();

            storage.write(storageKey, content);
        } catch (IOException exception) {
            log.error("Failed to store attachment {}", storageKey, exception);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "첨부파일을 저장하지 못했습니다.");
        }

        String displayName = limitName(name.substring(0, extensionStart), extension);
        TaskAttachment saved = attachments.save(new TaskAttachment(task, users.getReferenceById(userId),
                displayName, storageKey, format.mediaType, file.getSize(), Instant.now()));
        events.publishEvent(new TaskChange(task.getProjectId(), taskId, TaskChange.Type.ATTACHMENTS_CHANGED));
        return saved;
    }

    private static String sanitizeName(String originalName) {
        String path = originalName == null ? "" : originalName.replace('\\', '/');
        return Normalizer.normalize(path.substring(path.lastIndexOf('/') + 1), Normalizer.Form.NFC)
                .replaceAll("[\\p{Cc}\\p{Cf}]", "")
                .replaceAll("[<>:\"|?*]", "_")
                .strip();
    }

    private static String limitName(String baseName, String extension) {
        String base = baseName.replaceAll("^[.\\s]+|[.\\s]+$", "");
        if (base.isEmpty()) {
            base = "attachment";
        }
        int maxBaseLength = MAX_DISPLAY_NAME_LENGTH - extension.length();
        if (base.codePointCount(0, base.length()) > maxBaseLength) {
            base = base.substring(0, base.offsetByCodePoints(0, maxBaseLength));
        }
        return base + extension;
    }

    private enum FileFormat {
        PDF("application/pdf", new byte[]{'%', 'P', 'D', 'F', '-'}, ".pdf"),
        PNG("image/png", new byte[]{(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10}, ".png"),
        JPEG("image/jpeg", new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff}, ".jpg", ".jpeg");

        private final String mediaType;
        private final byte[] signature;
        private final String[] extensions;

        FileFormat(String mediaType, byte[] signature, String... extensions) {
            this.mediaType = mediaType;
            this.signature = signature;
            this.extensions = extensions;
        }

        static FileFormat detect(String extension, byte[] prefix) {
            for (FileFormat format : values()) {
                if (Arrays.asList(format.extensions).contains(extension) && prefix.length >= format.signature.length
                        && Arrays.equals(prefix, 0, format.signature.length, format.signature, 0, format.signature.length)) {
                    return format;
                }
            }
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                    "파일 형식이 올바른 PDF, PNG, JPEG만 첨부할 수 있습니다.");
        }
    }
}
