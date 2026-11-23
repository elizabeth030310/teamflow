package com.teamflow.backend.controller;

import com.teamflow.backend.repository.ProjectPageRepository;
import com.teamflow.backend.repository.ProjectPageRepository.Page;
import com.teamflow.backend.repository.ProjectPageRepository.PageSummary;
import com.teamflow.backend.repository.ProjectPageRepository.TreeEntry;
import com.teamflow.backend.repository.ProjectRepository;
import com.teamflow.backend.service.ProjectAccess;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/projects/{projectId}/pages")
public class ProjectPageController {

    private final ProjectAccess access;
    private final ProjectRepository projects;
    private final ProjectPageRepository pages;

    public ProjectPageController(ProjectAccess access, ProjectRepository projects, ProjectPageRepository pages) {
        this.access = access;
        this.projects = projects;
        this.pages = pages;
    }

    @GetMapping
    public List<PageSummary> roots(@PathVariable long projectId, HttpSession session) {
        requireAccess(projectId, session);
        return pages.children(projectId, null);
    }

    @GetMapping("/tree")
    public List<TreeEntry> tree(@PathVariable long projectId, HttpSession session) {
        requireAccess(projectId, session);
        return pages.tree(projectId);
    }

    @GetMapping("/{pageId}")
    public Page get(@PathVariable long projectId, @PathVariable long pageId, HttpSession session) {
        requireAccess(projectId, session);
        return requirePage(projectId, pageId);
    }

    @GetMapping("/{pageId}/children")
    public List<PageSummary> children(@PathVariable long projectId, @PathVariable long pageId, HttpSession session) {
        requireAccess(projectId, session);
        requirePage(projectId, pageId);
        return pages.children(projectId, pageId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Page create(@PathVariable long projectId, @Valid @RequestBody PageRequest request, HttpSession session) {
        lockAccessibleProject(projectId, session);
        validateParent(projectId, request.parentPageId());
        return pages.create(projectId, request.parentPageId(), request.title().strip(), request.pageContent(), request.pageContentFormat());
    }

    @PutMapping("/{pageId}")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Page update(@PathVariable long projectId, @PathVariable long pageId,
                       @Valid @RequestBody PageRequest request, HttpSession session) {
        lockAccessibleProject(projectId, session);
        Page current = requirePage(projectId, pageId);
        if (request.expectedUpdatedAt() != null && !request.expectedUpdatedAt().isEqual(current.updatedAt())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "페이지가 변경되었습니다.");
        }
        Long parentPageId = request.parentPageId();
        validateParent(projectId, parentPageId);
        if (parentPageId != null && pages.wouldCycle(projectId, pageId, parentPageId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "페이지 계층에 순환이 생깁니다.");
        }
        return pages.update(projectId, pageId, parentPageId, request.title().strip(), request.pageContent(), request.pageContentFormat());
    }

    @DeleteMapping("/{pageId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void delete(@PathVariable long projectId, @PathVariable long pageId, HttpSession session) {
        lockAccessibleProject(projectId, session);
        requirePage(projectId, pageId);
        if (pages.hasChildren(projectId, pageId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "하위 페이지를 먼저 이동하거나 삭제하세요.");
        }
        pages.delete(projectId, pageId);
    }

    private void requireAccess(long projectId, HttpSession session) {
        access.requireAccessible(projectId, access.currentUserId(session));
    }

    private void lockAccessibleProject(long projectId, HttpSession session) {
        requireAccess(projectId, session);
        projects.findLockedById(projectId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "프로젝트를 찾을 수 없습니다."));
        requireAccess(projectId, session);
    }

    private Page requirePage(long projectId, long pageId) {
        return pages.find(projectId, pageId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "페이지를 찾을 수 없습니다."));
    }

    private void validateParent(long projectId, Long parentPageId) {
        if (parentPageId != null && pages.find(projectId, parentPageId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "같은 프로젝트의 상위 페이지를 지정하세요.");
        }
    }

    public record PageRequest(
            @Positive Long parentPageId,
            @NotBlank @Size(max = 200) @Pattern(regexp = "[^\\x00]*") String title,
            @Size(max = 6000000) @Pattern(regexp = "[^\\x00]*") String content,
            @Pattern(regexp = "plain|rich-v1") String contentFormat,
            OffsetDateTime expectedUpdatedAt) {

        String pageContent() {
            if (content != null && content.length() > 100000 && pageContentFormat().equals("plain")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "본문이 너무 깁니다.");
            }
            return content == null ? "" : content;
        }

        String pageContentFormat() {
            return contentFormat == null ? "plain" : contentFormat;
        }
    }
}
