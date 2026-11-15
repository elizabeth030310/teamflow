
package com.teamflow.backend.repository;

import com.teamflow.backend.entity.Task;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.util.List;
import java.util.Optional;

public interface TaskRepository extends JpaRepository<Task, Long> {

    // 특정 프로젝트에 속한 작업 카드 조회
    List<Task> findByProjectId(Long projectId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Task> findOneById(Long id);

}
