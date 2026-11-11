
package com.teamflow.backend.controller;

import com.teamflow.backend.entity.Task;
import com.teamflow.backend.repository.TaskRepository;
import com.teamflow.backend.repository.ProjectRepository;

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

    // 특정 프로젝트의 작업 카드 조회
    @GetMapping("/project/{projectId}")
    public List<Task> getTasksByProject(
            @PathVariable Long projectId) {

        if (!projectRepository.existsById(projectId)) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "프로젝트를 찾을 수 없습니다."
            );
        }

        return taskRepository.findByProjectId(projectId);
    }

    // 작업 카드 생성
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Task createTask(@RequestBody Task task) {

        if (task.getProjectId() == null ||
                task.getTitle() == null ||
                task.getTitle().isBlank()) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "프로젝트 ID와 작업 제목은 필수입니다."
            );
        }

        if (!projectRepository.existsById(task.getProjectId())) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "프로젝트를 찾을 수 없습니다."
            );
        }

        task.setTitle(task.getTitle().trim());

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

        return taskRepository.save(task);
    }

    // 작업 카드 제목과 설명 수정
    @PutMapping("/{id}")
    public Task updateTask(
            @PathVariable Long id,
            @RequestBody Task request) {

        Task task = taskRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "작업 카드를 찾을 수 없습니다."
                ));

        if (request.getTitle() == null ||
                request.getTitle().isBlank()) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "작업 제목은 필수입니다."
            );
        }

        task.setTitle(request.getTitle().trim());
        task.setDescription(request.getDescription());

        return taskRepository.save(task);
    }

    // 작업 카드 상태 변경
    @PatchMapping("/{id}/status")
    public Task updateTaskStatus(
            @PathVariable Long id,
            @RequestBody Map<String, String> request) {

        Task task = taskRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "작업 카드를 찾을 수 없습니다."
                ));

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
    public void deleteTask(@PathVariable Long id) {

        if (!taskRepository.existsById(id)) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "작업 카드를 찾을 수 없습니다."
            );
        }

        taskRepository.deleteById(id);
    }

    // 작업 상태 유효성 검사
    private boolean isValidStatus(String status) {
        return "TODO".equals(status) ||
                "IN_PROGRESS".equals(status) ||
                "DONE".equals(status);
    }
}
