package com.teamflow.backend.controller;

import com.teamflow.backend.service.NotificationService;
import com.teamflow.backend.service.ProjectAccess;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final ProjectAccess access;
    private final NotificationService notifications;

    public NotificationController(ProjectAccess access, NotificationService notifications) {
        this.access = access;
        this.notifications = notifications;
    }

    @GetMapping
    public ResponseEntity<NotificationService.Inbox> inbox(@RequestParam(defaultValue = "0") int page,
                                                           HttpSession session) {
        Long userId = access.currentUserId(session);
        if (page < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(notifications.inbox(userId, page));
    }

    @PatchMapping("/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@PathVariable long id, HttpSession session) {
        if (!notifications.markRead(access.currentUserId(session), id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    @PatchMapping("/read-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markAllRead(HttpSession session) {
        notifications.markAllRead(access.currentUserId(session));
    }
}
