
package com.teamflow.backend.repository;

import com.teamflow.backend.entity.Task;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TaskRepository extends JpaRepository<Task, Long> {

    // 특정 프로젝트에 속한 작업 카드 조회
    List<Task> findByProjectId(Long projectId);

}
