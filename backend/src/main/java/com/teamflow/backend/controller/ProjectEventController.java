package com.teamflow.backend.controller;

import com.teamflow.backend.service.ProjectAccess;
import com.teamflow.backend.service.ProjectEventStreams;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.cors.CorsUtils;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
public class ProjectEventController {
    private final ProjectAccess access;
    private final ProjectEventStreams streams;

    public ProjectEventController(ProjectAccess access, ProjectEventStreams streams) {
        this.access = access;
        this.streams = streams;
    }

    @GetMapping(path = "/api/projects/{projectId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> subscribe(@PathVariable Long projectId, HttpServletRequest request) {
        if (!"GET".equals(request.getMethod())) {
            throw new ResponseStatusException(HttpStatus.METHOD_NOT_ALLOWED);
        }
        if ("cross-site".equals(request.getHeader("Sec-Fetch-Site")) || !hasAllowedOrigin(request)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }

        HttpSession session = request.getSession(false);
        if (session == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        Long userId = access.currentUserId(session);
        access.requireAccessible(projectId, userId);

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header("X-Accel-Buffering", "no")
                .body(streams.subscribe(projectId, userId, session));
    }

    private boolean hasAllowedOrigin(HttpServletRequest request) {
        try {
            return !CorsUtils.isCorsRequest(request);
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }
}
