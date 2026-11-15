package com.teamflow.backend.controller;

import com.teamflow.backend.repository.TaskActivityRepository;
import com.teamflow.backend.repository.TaskActivityRepository.ActivitySummary;
import com.teamflow.backend.service.ProjectAccess;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class ProjectActivityController {
    private final ProjectAccess access;
    private final TaskActivityRepository activities;

    public ProjectActivityController(ProjectAccess access, TaskActivityRepository activities) {
        this.access = access;
        this.activities = activities;
    }

    @GetMapping("/api/projects/{projectId}/activities")
    @Transactional(readOnly = true)
    public ResponseEntity<List<ActivitySummary>> listActivities(@PathVariable Long projectId, HttpSession session) {
        access.requireAccessible(projectId, access.currentUserId(session));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(activities.findTop50ByProject_IdOrderByCreatedAtDescIdDesc(projectId));
    }
}
