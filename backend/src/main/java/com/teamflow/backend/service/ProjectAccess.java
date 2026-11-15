package com.teamflow.backend.service;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.ProjectMember.Status;
import com.teamflow.backend.repository.ProjectRepository;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class ProjectAccess {

    private final ProjectRepository projectRepository;

    public ProjectAccess(ProjectRepository projectRepository) {
        this.projectRepository = projectRepository;
    }

    public Long currentUserId(HttpSession session) {
        if (session.getAttribute("userId") instanceof Long userId) {
            return userId;
        }
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다.");
    }

    public Project requireAccessible(Long projectId, Long userId) {
        return projectRepository.findAccessibleProject(projectId, userId, Status.ACCEPTED)
                .orElseThrow(this::projectNotFound);
    }

    public Project requireOwner(Long projectId, Long userId) {
        return projectRepository.findByIdAndOwnerId(projectId, userId)
                .orElseThrow(this::projectNotFound);
    }

    public Project lockOwnedProject(Long projectId, Long userId) {
        return projectRepository.findOneByIdAndOwnerId(projectId, userId)
                .orElseThrow(this::projectNotFound);
    }

    private ResponseStatusException projectNotFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "프로젝트를 찾을 수 없습니다.");
    }
}
