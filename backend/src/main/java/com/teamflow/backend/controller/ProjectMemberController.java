package com.teamflow.backend.controller;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.ProjectMember;
import com.teamflow.backend.entity.ProjectMember.Status;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.ProjectMemberRepository;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.ProjectAccess;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
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

    public ProjectMemberController(ProjectAccess access, ProjectMemberRepository members, UserRepository users) {
        this.access = access;
        this.members = members;
        this.users = users;
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
                    member.getUser().getEmail(), member.getStatus());
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
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "등록된 사용자를 찾을 수 없습니다."));
        if (userId.equals(invitee.getId()) || members.existsByProjectIdAndUserId(projectId, invitee.getId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 소유자이거나 초대 기록이 있는 사용자입니다.");
        }
        return InvitationResponse.from(members.save(new ProjectMember(project, invitee)));
    }

    @GetMapping("/{projectId}/invitations")
    @Transactional(readOnly = true)
    public List<InvitationResponse> listProjectInvitations(@PathVariable Long projectId, HttpSession session) {
        access.requireOwner(projectId, access.currentUserId(session));
        return members.findByProjectIdOrderById(projectId).stream().map(InvitationResponse::from).toList();
    }

    @GetMapping("/invitations")
    @Transactional(readOnly = true)
    public List<InvitationResponse> listMyInvitations(HttpSession session) {
        return members.findByUserIdAndStatusOrderById(access.currentUserId(session), Status.PENDING)
                .stream().map(InvitationResponse::from).toList();
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
        if (member.getStatus() != Status.PENDING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 처리된 초대입니다.");
        }
        member.respond(accept);
        return InvitationResponse.from(member);
    }
}
