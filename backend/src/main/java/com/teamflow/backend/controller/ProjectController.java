
package com.teamflow.backend.controller;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.repository.ProjectRepository;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    private final ProjectRepository projectRepository;

    public ProjectController(ProjectRepository projectRepository) {
        this.projectRepository = projectRepository;
    }

    // 프로젝트 전체 조회
    @GetMapping
    public List<Project> getProjects() {
        return projectRepository.findAll();
    }

    // 프로젝트 생성
    @PostMapping
    public Project createProject(@RequestBody Project project) {
        return projectRepository.save(project);
    }

    // 프로젝트 수정
    @PutMapping("/{id}")
    public Project updateProject(
            @PathVariable Long id,
            @RequestBody Project updatedProject) {

        Project project = projectRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "프로젝트를 찾을 수 없습니다."
                ));

        project.setName(updatedProject.getName());
        project.setDescription(updatedProject.getDescription());

        return projectRepository.save(project);
    }

    // 프로젝트 삭제
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteProject(@PathVariable Long id) {

        if (!projectRepository.existsById(id)) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "프로젝트를 찾을 수 없습니다."
            );
        }

        projectRepository.deleteById(id);
    }
}
