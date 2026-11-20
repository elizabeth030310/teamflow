package com.teamflow.backend.controller;

import com.teamflow.backend.entity.TaskActivity;
import com.teamflow.backend.entity.TaskComment;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.TaskCommentRepository;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.CommentChange;
import com.teamflow.backend.service.NotificationService;
import com.teamflow.backend.service.ProjectAccess;
import com.teamflow.backend.service.TaskActivityRecorder;
import jakarta.servlet.http.HttpSession;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/tasks/{taskId}/comments")
public class TaskCommentController {

    private final ProjectAccess access;
    private final TaskCommentRepository comments;
    private final TaskActivityRecorder activities;
    private final UserRepository users;
    private final ApplicationEventPublisher events;
    private final NotificationService notifications;

    public TaskCommentController(ProjectAccess access, TaskCommentRepository comments,
                                 TaskActivityRecorder activities, UserRepository users,
                                 ApplicationEventPublisher events, NotificationService notifications) {
        this.access = access;
        this.comments = comments;
        this.activities = activities;
        this.users = users;
        this.events = events;
        this.notifications = notifications;
    }

    public record CommentResponse(Long id, Long taskId, Long authorId, String authorName, String content,
                                  Instant createdAt, Long parentCommentId, boolean deleted) {
        static CommentResponse from(TaskComment comment) {
            User author = comment.getAuthor();
            return new CommentResponse(comment.getId(), comment.getTask().getId(), author.getId(),
                    author.getName(), comment.getContent(), comment.getCreatedAt(),
                    comment.getParentCommentId(), comment.isDeleted());
        }
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<CommentResponse> listComments(@PathVariable Long taskId, HttpSession session) {
        access.requireAccessibleTask(taskId, access.currentUserId(session));
        return comments.findByTaskIdOrderByCreatedAtAscIdAsc(taskId).stream()
                .map(CommentResponse::from)
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public CommentResponse createComment(@PathVariable Long taskId, @RequestBody JsonNode request,
                                         HttpSession session) {
        Long userId = access.currentUserId(session);
        var target = access.lockAccessibleTask(taskId, userId);
        String content = requireContent(request);
        Long parentCommentId = readParentCommentId(request);
        TaskComment parent = null;
        if (parentCommentId != null) {
            parent = requireActiveComment(taskId, parentCommentId);
            if (parent.getParentCommentId() != null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "대댓글에는 답글을 달 수 없습니다.");
            }
        }

        User author = users.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다."));
        TaskComment saved = comments.save(new TaskComment(target.task(), author, content, parentCommentId));
        activities.record(TaskActivity.commentCreated(target.project(), target.task(), author));
        if (parent == null) {
            notifications.commented(taskId, userId);
        } else {
            notifications.replied(taskId, parent.getAuthor().getId(), userId, author.getName(),
                    parent.getId(), saved.getId());
        }
        events.publishEvent(new CommentChange(target.project().getId(), taskId));
        return CommentResponse.from(saved);
    }

    @PatchMapping("/{commentId}")
    @Transactional
    public CommentResponse editComment(@PathVariable Long taskId, @PathVariable Long commentId,
                                       @RequestBody JsonNode request, HttpSession session) {
        Long userId = access.currentUserId(session);
        var target = access.lockAccessibleTask(taskId, userId);
        TaskComment comment = requireActiveComment(taskId, commentId);
        requireAuthor(comment, userId);
        if (request.has("parentCommentId")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "댓글의 부모는 변경할 수 없습니다.");
        }
        comment.edit(requireContent(request));
        events.publishEvent(new CommentChange(target.project().getId(), taskId));
        return CommentResponse.from(comment);
    }

    @DeleteMapping("/{commentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void deleteComment(@PathVariable Long taskId, @PathVariable Long commentId, HttpSession session) {
        Long userId = access.currentUserId(session);
        var target = access.lockAccessibleTask(taskId, userId);
        TaskComment comment = requireActiveComment(taskId, commentId);
        requireAuthor(comment, userId);
        if (comment.getParentCommentId() == null && comments.existsByParentCommentId(commentId)) {
            comment.removeContent();
        } else {
            comments.delete(comment);
        }
        activities.record(TaskActivity.commentDeleted(target.project(), target.task(), comment.getAuthor()));
        events.publishEvent(new CommentChange(target.project().getId(), taskId));
    }

    private TaskComment requireActiveComment(Long taskId, Long commentId) {
        return comments.findByIdAndTaskId(commentId, taskId)
                .filter(comment -> !comment.isDeleted())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "댓글을 찾을 수 없습니다."));
    }

    private void requireAuthor(TaskComment comment, Long userId) {
        if (!userId.equals(comment.getAuthor().getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "댓글 작성자만 수정하거나 삭제할 수 있습니다.");
        }
    }

    private String requireContent(JsonNode request) {
        JsonNode contentNode = request.get("content");
        String content = contentNode != null && contentNode.isString() ? contentNode.stringValue().strip() : "";
        if (content.isEmpty() || content.codePointCount(0, content.length()) > TaskComment.MAX_CONTENT_LENGTH) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "댓글은 1자 이상 1,000자 이하여야 합니다.");
        }
        return content;
    }

    private Long readParentCommentId(JsonNode request) {
        JsonNode parent = request.get("parentCommentId");
        if (parent == null || parent.isNull()) {
            return null;
        }
        if (!parent.isIntegralNumber() || !parent.canConvertToLong() || parent.longValue() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "부모 댓글 ID는 양의 정수여야 합니다.");
        }
        return parent.longValue();
    }
}
