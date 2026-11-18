package com.teamflow.backend.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.UUID;

@Component
public class AttachmentStorage {

    private static final Logger log = LoggerFactory.getLogger(AttachmentStorage.class);
    private final Path storageRoot;

    public AttachmentStorage(@Value("${teamflow.attachments.storage-root}") String configuredRoot) {
        storageRoot = configuredRoot.isBlank() ? null : Path.of(configuredRoot).normalize();
        if (storageRoot != null && (!storageRoot.isAbsolute() || storageRoot.getParent() == null)) {
            throw new IllegalArgumentException("첨부파일 저장 폴더는 전용 절대 경로여야 합니다.");
        }
    }

    public boolean isConfigured() {
        return storageRoot != null;
    }

    public void requireConfigured() {
        if (!isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "첨부파일 저장소 설정이 필요합니다.");
        }
    }

    public void write(UUID storageKey, InputStream content) throws IOException {
        if (storageRoot.getFileSystem().supportedFileAttributeViews().contains("posix")) {
            Files.createDirectories(storageRoot, PosixFilePermissions.asFileAttribute(
                    PosixFilePermissions.fromString("rwx------")));
        } else {
            Files.createDirectories(storageRoot);
        }
        Path target = resolve(storageKey);
        try (var output = Files.newOutputStream(target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            removeOnRollback(target);
            content.transferTo(output);
        }
    }

    public Resource download(UUID storageKey) {
        requireConfigured();
        try {
            Path target = resolve(storageKey);
            if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
                throw new NoSuchFileException(storageKey.toString());
            }
            return new InputStreamResource(() -> Files.newInputStream(target, LinkOption.NOFOLLOW_LINKS));
        } catch (NoSuchFileException exception) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "첨부파일을 찾을 수 없습니다.");
        } catch (IOException exception) {
            log.error("Failed to open attachment {}", storageKey, exception);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "첨부파일을 읽지 못했습니다.");
        }
    }

    public void delete(UUID storageKey) throws IOException {
        Path target = resolve(storageKey);
        if (Files.isDirectory(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("An attachment key cannot be a directory");
        }
        Files.deleteIfExists(target);
    }

    private Path resolve(UUID storageKey) throws IOException {
        if (Files.isSymbolicLink(storageRoot)) {
            throw new IOException("The upload directory cannot be a symbolic link");
        }
        return storageRoot.toRealPath().resolve(storageKey.toString());
    }

    private void removeOnRollback(Path target) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                if (status == STATUS_ROLLED_BACK) {
                    try {
                        Files.deleteIfExists(target);
                    } catch (IOException exception) {
                        log.error("Failed to remove rolled-back attachment {}", target.getFileName(), exception);
                    }
                }
            }
        });
    }
}
