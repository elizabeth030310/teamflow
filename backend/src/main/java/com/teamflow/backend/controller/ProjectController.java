
package com.teamflow.backend.controller;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.ProjectMember.Status;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.ProjectRepository;
import com.teamflow.backend.repository.UserRepository;

import com.teamflow.backend.service.ProjectAccess;

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
    private final ProjectAccess access;

    public ProjectController(
            ProjectRepository projectRepository,
            UserRepository userRepository,
            ProjectAccess access) {

        this.projectRepository = projectRepository;
        this.userRepository = userRepository;
        this.access = access;
    }

    // 로그인한 사용자의 프로젝트 목록 조회
    @GetMapping
    public List<Project> getProjects(HttpSession session) {

        Long userId = access.currentUserId(session);

        return projectRepository.findAccessibleProjects(userId, Status.ACCEPTED);
    }

    @GetMapping("/{id}")
    public Project getProject(@PathVariable Long id, HttpSession session) {
        return access.requireAccessible(id, access.currentUserId(session));
    }

    // 프로젝트 생성
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Project createProject(
            @RequestBody Project requestedProject,
            HttpSession session) {

        Long userId = access.currentUserId(session);

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

        Long userId = access.currentUserId(session);

        Project project = access.requireOwner(id, userId);

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

        Long userId = access.currentUserId(session);

        Project project = access.requireOwner(id, userId);

        projectRepository.delete(project);
    }
}
