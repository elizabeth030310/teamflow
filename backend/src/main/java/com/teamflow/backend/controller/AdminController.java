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

    public record AuditPage(List<AuditEntry> entries, String nextCursor) {
    }

    public record MemberStats(long total, long active, long suspended, long withdrawn) {
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
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(findAuditEntries(Long.MAX_VALUE, null, 100));
    }

    @GetMapping("/audit/page")
    public ResponseEntity<AuditPage> auditPage(
            @RequestParam(defaultValue = "9223372036854775807") long cursor,
            @RequestParam(required = false) User.Status toStatus,
            @RequestParam(defaultValue = "25") int limit) {
        if (cursor < 1 || limit < 1 || limit > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        }
        var entries = findAuditEntries(cursor, toStatus, limit + 1);
        String nextCursor = entries.size() > limit ? Long.toString(entries.get(limit).id()) : null;
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new AuditPage(entries.subList(0, Math.min(limit, entries.size())), nextCursor));
    }

    @GetMapping("/users/stats")
    public ResponseEntity<MemberStats> memberStats() {
        var stats = jdbc.queryForObject("""
                SELECT count(*) AS total,
                       count(*) FILTER (WHERE account_status = 'ACTIVE') AS active,
                       count(*) FILTER (WHERE account_status = 'SUSPENDED') AS suspended,
                       count(*) FILTER (WHERE account_status = 'WITHDRAWN') AS withdrawn
                FROM users WHERE role = 'USER'
                """, (row, index) -> new MemberStats(row.getLong("total"), row.getLong("active"),
                row.getLong("suspended"), row.getLong("withdrawn")));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(stats);
    }

    private List<AuditEntry> findAuditEntries(long cursor, User.Status toStatus, int limit) {
        String status = toStatus == null ? "" : toStatus.name();
        return jdbc.query("""
                SELECT id, actor_id, target_id, from_status, to_status, reason, occurred_at
                FROM admin_member_audit
                WHERE id <= ? AND (? = '' OR to_status = ?)
                ORDER BY id DESC LIMIT ?
                """, (row, index) -> new AuditEntry(row.getLong("id"), row.getLong("actor_id"),
                row.getLong("target_id"), User.Status.valueOf(row.getString("from_status")),
                User.Status.valueOf(row.getString("to_status")), row.getString("reason"),
                row.getObject("occurred_at", OffsetDateTime.class)), cursor, status, status, limit);
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
