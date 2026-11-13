
package com.teamflow.backend.controller;

import com.teamflow.backend.entity.Task;
import com.teamflow.backend.repository.TaskRepository;
import com.teamflow.backend.repository.ProjectRepository;

import jakarta.servlet.http.HttpSession;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskRepository taskRepository;
    private final ProjectRepository projectRepository;

    public TaskController(
            TaskRepository taskRepository,
            ProjectRepository projectRepository) {

        this.taskRepository = taskRepository;
        this.projectRepository = projectRepository;
    }

    // 현재 로그인한 사용자 ID 조회
    private Long getCurrentUserId(HttpSession session) {

        Object userId = session.getAttribute("userId");

        if (!(userId instanceof Long)) {
            throw new ResponseStatusException(
                    HttpStatus.UNAUTHORIZED,
                    "로그인이 필요합니다."
            );
        }

        return (Long) userId;
    }

    // 프로젝트가 현재 사용자의 것인지 확인
    private void checkProjectOwnership(Long projectId, Long userId) {

        if (projectId == null ||
                projectRepository.findByIdAndOwnerId(projectId, userId).isEmpty()) {

            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "프로젝트를 찾을 수 없습니다."
            );
        }
    }

    // 작업이 현재 사용자의 프로젝트에 속하는지 확인
    private Task getOwnedTask(Long taskId, Long userId) {

        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "작업 카드를 찾을 수 없습니다."
                ));

        checkProjectOwnership(task.getProjectId(), userId);

        return task;
    }

    // 특정 프로젝트의 작업 카드 조회
    @GetMapping("/project/{projectId}")
    public List<Task> getTasksByProject(
            @PathVariable Long projectId,
            HttpSession session) {

        Long userId = getCurrentUserId(session);

        checkProjectOwnership(projectId, userId);

        return taskRepository.findByProjectId(projectId);
    }

    // 작업 카드 생성
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Task createTask(
            @RequestBody Task task,
            HttpSession session) {

        Long userId = getCurrentUserId(session);

        if (task.getProjectId() == null ||
                task.getTitle() == null ||
                task.getTitle().isBlank()) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "프로젝트 ID와 작업 제목은 필수입니다."
            );
        }

        checkProjectOwnership(task.getProjectId(), userId);

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
        return taskRepository.save(task);
    }

    // 작업 카드 제목, 설명, 우선순위, 마감일 수정
    @PutMapping("/{id}")
    public Task updateTask(
            @PathVariable Long id,
            @RequestBody Task request,
            HttpSession session) {

        Long userId = getCurrentUserId(session);

        Task task = getOwnedTask(id, userId);

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

        return taskRepository.save(task);
    }

    // 작업 카드 상태 변경
    @PatchMapping("/{id}/status")
    public Task updateTaskStatus(
            @PathVariable Long id,
            @RequestBody Map<String, String> request,
            HttpSession session) {

        Long userId = getCurrentUserId(session);

        Task task = getOwnedTask(id, userId);

        String status = request.get("status");

        if (!isValidStatus(status)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "올바르지 않은 작업 상태입니다."
            );
        }

        task.setStatus(status);

        return taskRepository.save(task);
    }

    // 작업 카드 삭제
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteTask(
            @PathVariable Long id,
            HttpSession session) {

        Long userId = getCurrentUserId(session);

        Task task = getOwnedTask(id, userId);

        taskRepository.delete(task);
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
