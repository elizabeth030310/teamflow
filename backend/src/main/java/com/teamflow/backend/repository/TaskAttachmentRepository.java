package com.teamflow.backend.repository;

import com.teamflow.backend.entity.TaskAttachment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TaskAttachmentRepository extends JpaRepository<TaskAttachment, Long> {

    List<TaskAttachment> findByTaskIdOrderByCreatedAtDescIdDesc(Long taskId);

    Optional<TaskAttachment> findByIdAndTaskId(Long id, Long taskId);

    @Query("select attachment.storageKey from TaskAttachment attachment where attachment.task.id = :taskId")
    List<UUID> findStorageKeysByTaskId(@Param("taskId") Long taskId);

    @Query("select attachment.storageKey from TaskAttachment attachment where attachment.task.projectId = :projectId")
    List<UUID> findStorageKeysByProjectId(@Param("projectId") Long projectId);

    @Modifying
    @Query("delete from TaskAttachment attachment where attachment.task.id in "
            + "(select task.id from Task task where task.projectId = :projectId)")
    void deleteAllByProjectId(@Param("projectId") Long projectId);
}
