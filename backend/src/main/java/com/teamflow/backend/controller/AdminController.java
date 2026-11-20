package com.teamflow.backend.controller;

import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.AccountAccess;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final UserRepository users;
    private final JdbcTemplate jdbc;

    public AdminController(UserRepository users, JdbcTemplate jdbc) {
        this.users = users;
        this.jdbc = jdbc;
    }

    public record Member(Long id, String name, String email, User.Role role,
                         User.Status status, long revision) {
    }

    public record AuditEntry(long id, long actorId, long targetId, User.Status fromStatus,
                             User.Status toStatus, String reason, OffsetDateTime occurredAt) {
    }

    public record StatusChange(@NotNull User.Status status, @NotNull @PositiveOrZero Long revision,
                               @NotBlank @Size(max = 300) String reason) {
    }

    @GetMapping("/users")
    public ResponseEntity<List<Member>> users() {
        var rows = users.findAdminUserRows().stream()
                .map(row -> new Member(row.getId(), row.getName(), row.getEmail(), row.getRole(),
                        row.getAccountStatus(), row.getAccessRevision()))
                .toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(rows);
    }

    @GetMapping("/audit")
    public ResponseEntity<List<AuditEntry>> audit() {
        var entries = jdbc.query("""
                SELECT id, actor_id, target_id, from_status, to_status, reason, occurred_at
                FROM admin_member_audit ORDER BY id DESC LIMIT 100
                """, (row, index) -> new AuditEntry(row.getLong("id"), row.getLong("actor_id"),
                row.getLong("target_id"), User.Status.valueOf(row.getString("from_status")),
                User.Status.valueOf(row.getString("to_status")), row.getString("reason"),
                row.getObject("occurred_at", OffsetDateTime.class)));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(entries);
    }

    @Transactional
    @PostMapping(value = "/users/{id}/status", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> changeStatus(@PathVariable Long id, @Valid @RequestBody StatusChange change,
                                             @RequestHeader(value = "X-TeamFlow-Admin", required = false) String intent,
                                             HttpSession session) {
        if (!"member-status".equals(intent)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        Long actorId = (Long) session.getAttribute("userId");
        User actor = users.findOneById(actorId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        if (actor.getAccountStatus() != User.Status.ACTIVE
                || actor.getAccessRevision() != AccountAccess.sessionRevision(session)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        if (actor.getRole() != User.Role.ADMIN || actorId.equals(id)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        User target = users.findOneById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (target.getRole() != User.Role.USER) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }

        User.Status previous = target.getAccountStatus();
        long revision = target.getAccessRevision();
        String reason = change.reason().strip();
        if (reason.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        }
        if (previous == change.status() && revision > 0 && change.revision() == revision - 1
                && Boolean.TRUE.equals(jdbc.queryForObject("""
                        SELECT EXISTS (SELECT 1 FROM admin_member_audit
                        WHERE target_id = ? AND target_revision = ? AND actor_id = ? AND reason = ?)
                        """, Boolean.class, id, revision, actorId, reason))) {
            return ResponseEntity.noContent().build();
        }
        if (change.revision() != revision || previous == change.status() || previous == User.Status.WITHDRAWN) {
            throw new ResponseStatusException(HttpStatus.CONFLICT);
        }

        target.changeAccountStatus(change.status());
        jdbc.update("""
                INSERT INTO admin_member_audit (actor_id, target_id, from_status, to_status, target_revision, reason)
                VALUES (?, ?, ?, ?, ?, ?)
                """, actorId, id, previous.name(), change.status().name(), target.getAccessRevision(), reason);
        return ResponseEntity.noContent().build();
    }
}
