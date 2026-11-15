package com.teamflow.backend.repository;

import com.teamflow.backend.entity.TaskComment;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.util.List;
import java.util.Optional;

public interface TaskCommentRepository extends JpaRepository<TaskComment, Long> {

    @EntityGraph(attributePaths = "author")
    List<TaskComment> findByTaskIdOrderByCreatedAtAscIdAsc(Long taskId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<TaskComment> findByIdAndTaskId(Long id, Long taskId);
}
