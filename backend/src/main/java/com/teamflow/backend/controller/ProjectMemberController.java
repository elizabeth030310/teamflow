package com.teamflow.backend.controller;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.ProjectMember;
import com.teamflow.backend.entity.ProjectMember.Status;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.ProjectMemberRepository;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.ProjectAccess;
import com.teamflow.backend.service.NotificationService;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@RestController
@RequestMapping("/api/projects")
public class ProjectMemberController {

    private final ProjectAccess access;
    private final ProjectMemberRepository members;
    private final UserRepository users;
    private final NotificationService notifications;

    public ProjectMemberController(ProjectAccess access, ProjectMemberRepository members, UserRepository users,
            NotificationService notifications) {
        this.access = access;
        this.members = members;
        this.users = users;
        this.notifications = notifications;
    }

    public enum Role {
        OWNER, MEMBER
    }

    public record InviteRequest(@NotBlank @Email @Size(max = 255) String email) {
        public InviteRequest {
            if (email != null) {
                email = email.trim().toLowerCase(Locale.ROOT);
            }
        }
    }

    public record MemberResponse(Long userId, String name, Role role) {
    }

    public record InvitationResponse(Long id, Long projectId, String projectName,
            Long userId, String email, Status status) {
        static InvitationResponse from(ProjectMember member) {
            return new InvitationResponse(member.getId(), member.getProject().getId(),
                    member.getProject().getName(), member.getUser().getId(),
                    member.getUser().getAccountStatus() == User.Status.WITHDRAWN ? "" : member.getUser().getEmail(),
                    member.getStatus());
        }
    }

    @GetMapping("/{projectId}/members")
    @Transactional(readOnly = true)
    public List<MemberResponse> listMembers(@PathVariable Long projectId, HttpSession session) {
        Project project = access.requireAccessible(projectId, access.currentUserId(session));
        List<MemberResponse> result = new ArrayList<>();
        User owner = project.getOwner();
        result.add(new MemberResponse(owner.getId(), owner.getName(), Role.OWNER));
        members.findByProjectIdAndStatusOrderById(projectId, Status.ACCEPTED).forEach(member -> {
            User user = member.getUser();
            result.add(new MemberResponse(user.getId(), user.getName(), Role.MEMBER));
        });
        return result;
    }

    @PostMapping("/{projectId}/invitations")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public InvitationResponse invite(@PathVariable Long projectId, @Valid @RequestBody InviteRequest request,
            HttpSession session) {
        Long userId = access.currentUserId(session);
        Project project = access.lockOwnedProject(projectId, userId);
        User invitee = users.findByEmail(request.email())
                .filter(user -> user.getAccountStatus() == User.Status.ACTIVE)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "등록된 사용자를 찾을 수 없습니다."));
        if (userId.equals(invitee.getId()) || members.existsByProjectIdAndUserId(projectId, invitee.getId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 소유자이거나 초대 기록이 있는 사용자입니다.");
        }
        ProjectMember member = members.save(new ProjectMember(project, invitee));
        notifications.publishInvitation(member.getId(), invitee.getId());
        return InvitationResponse.from(member);
    }

    @PostMapping("/{projectId}/invitations/{invitationId}/resend")
    @Transactional
    public InvitationResponse resend(@PathVariable Long projectId, @PathVariable Long invitationId,
            HttpSession session) {
        access.requireOwner(projectId, access.currentUserId(session));
        ProjectMember member = members.findByIdAndProjectId(invitationId, projectId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "초대를 찾을 수 없습니다."));
        requirePending(member);
        Long recipientId = member.getUser().getId();
        users.findOneById(recipientId).filter(user -> user.getAccountStatus() == User.Status.ACTIVE)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "활성 계정을 찾을 수 없습니다."));
        if (!notifications.publishInvitation(invitationId, recipientId)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "1분 뒤 다시 시도해 주세요.");
        }
        return InvitationResponse.from(member);
    }

    @GetMapping("/{projectId}/invitations")
    @Transactional(readOnly = true)
    public List<InvitationResponse> listProjectInvitations(@PathVariable Long projectId, HttpSession session) {
        access.requireOwner(projectId, access.currentUserId(session));
        return members.findByProjectIdOrderById(projectId).stream().map(InvitationResponse::from).toList();
    }

    @GetMapping("/invitations")
    @Transactional(readOnly = true)
    public ResponseEntity<List<InvitationResponse>> listMyInvitations(HttpSession session) {
        List<InvitationResponse> invitations = members.findByUserIdAndStatusOrderById(
                access.currentUserId(session), Status.PENDING)
                .stream().map(InvitationResponse::from).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(invitations);
    }

    @PostMapping("/invitations/{invitationId}/accept")
    @Transactional
    public InvitationResponse accept(@PathVariable Long invitationId, HttpSession session) {
        return respond(invitationId, access.currentUserId(session), true);
    }

    @PostMapping("/invitations/{invitationId}/reject")
    @Transactional
    public InvitationResponse reject(@PathVariable Long invitationId, HttpSession session) {
        return respond(invitationId, access.currentUserId(session), false);
    }

    private InvitationResponse respond(Long invitationId, Long userId, boolean accept) {
        ProjectMember member = members.findByIdAndUserId(invitationId, userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "초대를 찾을 수 없습니다."));
        requirePending(member);
        member.respond(accept);
        notifications.invitationChanged(userId);
        return InvitationResponse.from(member);
    }

    private void requirePending(ProjectMember member) {
        if (member.getStatus() != Status.PENDING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 처리된 초대입니다.");
        }
    }
}
