package com.teamflow.backend.repository;

import com.teamflow.backend.entity.TaskChecklistItem;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface TaskChecklistItemRepository extends JpaRepository<TaskChecklistItem, Long> {

    List<TaskChecklistItem> findByTaskIdOrderByIdAsc(Long taskId);

    interface Progress {
        Long getTaskId();
        long getTotal();
        long getCompleted();
    }

    @Query("""
            select item.task.id as taskId, count(item) as total,
                   sum(case when item.completed = true then 1 else 0 end) as completed
            from TaskChecklistItem item
            where item.task.projectId = :projectId
            group by item.task.id
            """)
    List<Progress> findProgressByProjectId(@Param("projectId") Long projectId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<TaskChecklistItem> findByIdAndTaskId(Long id, Long taskId);
}
