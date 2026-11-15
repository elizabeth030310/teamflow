
package com.teamflow.backend.controller;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.Task;
import com.teamflow.backend.entity.TaskActivity;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.TaskRepository;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.ProjectAccess;
import com.teamflow.backend.service.TaskActivityRecorder;
import com.teamflow.backend.service.TaskChange;

import jakarta.servlet.http.HttpSession;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.Map;
import java.util.Objects;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskRepository taskRepository;
    private final TaskActivityRecorder activities;
    private final UserRepository users;
    private final ProjectAccess access;
    private final ApplicationEventPublisher events;

    public TaskController(
            TaskRepository taskRepository,
            TaskActivityRecorder activities,
            UserRepository users,
            ProjectAccess access,
            ApplicationEventPublisher events) {

        this.taskRepository = taskRepository;
        this.activities = activities;
        this.users = users;
        this.access = access;
        this.events = events;
    }

    // 특정 프로젝트의 작업 카드 조회
    @GetMapping("/project/{projectId}")
    public List<Task> getTasksByProject(
            @PathVariable Long projectId,
            HttpSession session) {

        Long userId = access.currentUserId(session);

        access.requireAccessible(projectId, userId);

        return taskRepository.findByProjectId(projectId);
    }

    // 작업 카드 생성
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Task createTask(
            @RequestBody Task task,
            HttpSession session) {

        Long userId = access.currentUserId(session);

        if (task.getProjectId() == null ||
                task.getTitle() == null ||
                task.getTitle().isBlank()) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "프로젝트 ID와 작업 제목은 필수입니다."
            );
        }

        Project project = access.requireAccessible(task.getProjectId(), userId);

        task.setTitle(task.getTitle().trim());

        // 상태 기본값
        if (task.getStatus() == null ||
                task.getStatus().isBlank()) {
            task.setStatus("TODO");
        }

        if (!isValidStatus(task.getStatus())) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "올바르지 않은 작업 상태입니다."
            );
        }

        // 우선순위 기본값
        if (task.getPriority() == null ||
                task.getPriority().isBlank()) {
            task.setPriority("MEDIUM");
        }

        if (!isValidPriority(task.getPriority())) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "올바르지 않은 우선순위입니다."
            );
        }

        // 마감일은 선택 사항
        Task saved = taskRepository.save(new Task(task.getProjectId(), task.getTitle(), task.getDescription(),
                task.getStatus(), task.getPriority(), task.getDueDate()));
        activities.record(TaskActivity.created(project, saved, requireActivityActor(userId)));
        publish(saved, TaskChange.Type.CREATED);
        return saved;
    }

    // 작업 카드 제목, 설명, 우선순위, 마감일 수정
    @PutMapping("/{id}")
    @Transactional
    public Task updateTask(
            @PathVariable Long id,
            @RequestBody Task request,
            HttpSession session) {

        Long userId = access.currentUserId(session);

        Task task = access.requireAccessibleTask(id, userId);

        // 제목 유효성 검사
        if (request.getTitle() == null ||
                request.getTitle().isBlank()) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "작업 제목은 필수입니다."
            );
        }

        // 우선순위 유효성 검사
        if (request.getPriority() != null &&
                !isValidPriority(request.getPriority())) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "올바르지 않은 우선순위입니다."
            );
        }

        // 제목과 설명 수정
        task.setTitle(request.getTitle().trim());
        task.setDescription(request.getDescription());

        // 우선순위가 전달된 경우에만 변경
        if (request.getPriority() != null) {
            task.setPriority(request.getPriority());
        }

        // 마감일 수정 또는 삭제
        // null이 전달되면 기존 마감일도 삭제됨
        task.setDueDate(request.getDueDate());

        Task saved = taskRepository.save(task);
        publish(saved, TaskChange.Type.UPDATED);
        return saved;
    }

    @PatchMapping("/{id}/assignee")
    @Transactional
    public Task updateTaskAssignee(
            @PathVariable Long id,
            @RequestBody JsonNode request,
            HttpSession session) {

        Long userId = access.currentUserId(session);
        Task task = lockTaskForActivity(id);
        Project project = access.requireAccessible(task.getProjectId(), userId);
        JsonNode assignee = request.get("assigneeId");

        if (assignee == null || !(assignee.isNull() ||
                (assignee.isIntegralNumber() && assignee.canConvertToLong()))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "담당자 ID는 정수 또는 null이어야 합니다.");
        }

        Long assigneeId = assignee.isNull() ? null : assignee.longValue();
        if (assigneeId != null) {
            access.requireEligibleAssignee(task.getProjectId(), assigneeId);
        }

        Long previousAssigneeId = task.getAssigneeId();
        if (Objects.equals(previousAssigneeId, assigneeId)) {
            return task;
        }

        task.setAssigneeId(assigneeId);
        Task saved = taskRepository.save(task);
        activities.record(TaskActivity.assigneeChanged(project, saved, requireActivityActor(userId), previousAssigneeId));
        publish(saved, TaskChange.Type.UPDATED);
        return saved;
    }

    // 작업 카드 상태 변경
    @PatchMapping("/{id}/status")
    @Transactional
    public Task updateTaskStatus(
            @PathVariable Long id,
            @RequestBody Map<String, String> request,
            HttpSession session) {

        Long userId = access.currentUserId(session);

        Task task = lockTaskForActivity(id);
        Project project = access.requireAccessible(task.getProjectId(), userId);

        String status = request.get("status");

        if (!isValidStatus(status)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "올바르지 않은 작업 상태입니다."
            );
        }

        String previousStatus = task.getStatus();
        if (status.equals(previousStatus)) {
            return task;
        }

        task.setStatus(status);
        Task saved = taskRepository.save(task);
        activities.record(TaskActivity.statusChanged(project, saved, requireActivityActor(userId), previousStatus));
        publish(saved, TaskChange.Type.STATUS_CHANGED);
        return saved;
    }

    // 작업 카드 삭제
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void deleteTask(
            @PathVariable Long id,
            HttpSession session) {

        Long userId = access.currentUserId(session);

        Task task = lockTaskForActivity(id);
        Project project = access.requireAccessible(task.getProjectId(), userId);

        activities.record(TaskActivity.deleted(project, task, requireActivityActor(userId)));
        taskRepository.delete(task);
        publish(task, TaskChange.Type.DELETED);
    }

    private Task lockTaskForActivity(Long id) {
        return taskRepository.findOneById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "작업 카드를 찾을 수 없습니다."));
    }

    private User requireActivityActor(Long userId) {
        return users.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다."));
    }

    private void publish(Task task, TaskChange.Type type) {
        events.publishEvent(new TaskChange(task.getProjectId(), task.getId(), type));
    }

    // 작업 상태 유효성 검사
    private boolean isValidStatus(String status) {
        return "TODO".equals(status) ||
                "IN_PROGRESS".equals(status) ||
                "DONE".equals(status);
    }

    // 작업 우선순위 유효성 검사
    private boolean isValidPriority(String priority) {
        return "HIGH".equals(priority) ||
                "MEDIUM".equals(priority) ||
                "LOW".equals(priority);
    }
}
