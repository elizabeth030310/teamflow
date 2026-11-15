package com.teamflow.backend.service;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.ProjectMember.Status;
import com.teamflow.backend.entity.Task;
import com.teamflow.backend.repository.ProjectRepository;
import com.teamflow.backend.repository.TaskRepository;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class ProjectAccess {

    private final ProjectRepository projectRepository;
    private final TaskRepository taskRepository;

    public ProjectAccess(ProjectRepository projectRepository, TaskRepository taskRepository) {
        this.projectRepository = projectRepository;
        this.taskRepository = taskRepository;
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

    public Task requireAccessibleTask(Long taskId, Long userId) {
        return requireAccessibleTaskWithProject(taskId, userId).task();
    }

    public TaskWithProject requireAccessibleTaskWithProject(Long taskId, Long userId) {
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "작업 카드를 찾을 수 없습니다."));
        return new TaskWithProject(task, requireAccessible(task.getProjectId(), userId));
    }

    public record TaskWithProject(Task task, Project project) {
    }

    public void requireEligibleAssignee(Long projectId, Long assigneeId) {
        if (projectRepository.findAccessibleProject(projectId, assigneeId, Status.ACCEPTED).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "담당자는 프로젝트 소유자 또는 초대를 수락한 멤버여야 합니다.");
        }
    }

    public Project lockOwnedProject(Long projectId, Long userId) {
        return projectRepository.findOneByIdAndOwnerId(projectId, userId)
                .orElseThrow(this::projectNotFound);
    }

    private ResponseStatusException projectNotFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "프로젝트를 찾을 수 없습니다.");
    }
}
