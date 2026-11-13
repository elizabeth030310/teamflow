
package com.teamflow.backend.controller;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.ProjectRepository;
import com.teamflow.backend.repository.UserRepository;

import jakarta.servlet.http.HttpSession;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    private final ProjectRepository projectRepository;
    private final UserRepository userRepository;

    public ProjectController(
            ProjectRepository projectRepository,
            UserRepository userRepository) {

        this.projectRepository = projectRepository;
        this.userRepository = userRepository;
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

    // 프로젝트 소유자 확인
    private Project getOwnedProject(Long projectId, Long userId) {

        return projectRepository.findByIdAndOwnerId(projectId, userId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "프로젝트를 찾을 수 없습니다."
                ));
    }

    // 로그인한 사용자의 프로젝트 목록 조회
    @GetMapping
    public List<Project> getProjects(HttpSession session) {

        Long userId = getCurrentUserId(session);

        return projectRepository.findByOwnerId(userId);
    }

    // 프로젝트 생성
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Project createProject(
            @RequestBody Project requestedProject,
            HttpSession session) {

        Long userId = getCurrentUserId(session);

        User owner = userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED,
                        "유효하지 않은 사용자입니다."
                ));

        Project project = new Project(
                requestedProject.getName(),
                requestedProject.getDescription()
        );

        project.setOwner(owner);

        return projectRepository.save(project);
    }

    // 프로젝트 수정
    @PutMapping("/{id}")
    public Project updateProject(
            @PathVariable Long id,
            @RequestBody Project updatedProject,
            HttpSession session) {

        Long userId = getCurrentUserId(session);

        Project project = getOwnedProject(id, userId);

        project.setName(updatedProject.getName());
        project.setDescription(updatedProject.getDescription());

        return projectRepository.save(project);
    }

    // 프로젝트 삭제
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteProject(
            @PathVariable Long id,
            HttpSession session) {

        Long userId = getCurrentUserId(session);

        Project project = getOwnedProject(id, userId);

        projectRepository.delete(project);
    }
}
