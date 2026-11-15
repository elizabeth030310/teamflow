package com.teamflow.backend.repository;

import com.teamflow.backend.entity.TaskActivity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface TaskActivityRepository extends JpaRepository<TaskActivity, Long> {
    List<ActivitySummary> findTop50ByProject_IdOrderByCreatedAtDescIdDesc(Long projectId);

    record ActivitySummary(Long id, Long taskId, String taskTitle, TaskActivity.Type type,
                           Long actorId, String actorName, Instant createdAt,
                           String previousStatus, String newStatus, Long previousAssigneeId, Long newAssigneeId) {
    }
}
