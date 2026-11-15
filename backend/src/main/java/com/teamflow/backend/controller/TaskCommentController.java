package com.teamflow.backend.controller;

import com.teamflow.backend.entity.Task;
import com.teamflow.backend.entity.TaskComment;
import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.TaskCommentRepository;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.CommentChange;
import com.teamflow.backend.service.ProjectAccess;
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
    private final UserRepository users;
    private final ApplicationEventPublisher events;

    public TaskCommentController(ProjectAccess access, TaskCommentRepository comments, UserRepository users,
                                 ApplicationEventPublisher events) {
        this.access = access;
        this.comments = comments;
        this.users = users;
        this.events = events;
    }

    public record CommentResponse(Long id, Long taskId, Long authorId, String authorName, String content,
                                  Instant createdAt) {
        static CommentResponse from(TaskComment comment) {
            User author = comment.getAuthor();
            return new CommentResponse(comment.getId(), comment.getTask().getId(), author.getId(),
                    author.getName(), comment.getContent(), comment.getCreatedAt());
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
        Task task = access.requireAccessibleTask(taskId, userId);
        JsonNode contentNode = request.get("content");
        String content = contentNode != null && contentNode.isString() ? contentNode.stringValue().strip() : "";
        if (content.isEmpty() || content.codePointCount(0, content.length()) > TaskComment.MAX_CONTENT_LENGTH) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "댓글은 1자 이상 1,000자 이하여야 합니다.");
        }

        User author = users.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다."));
        TaskComment saved = comments.save(new TaskComment(task, author, content));
        events.publishEvent(new CommentChange(task.getProjectId(), taskId));
        return CommentResponse.from(saved);
    }

    @DeleteMapping("/{commentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void deleteComment(@PathVariable Long taskId, @PathVariable Long commentId, HttpSession session) {
        Long userId = access.currentUserId(session);
        Task task = access.requireAccessibleTask(taskId, userId);
        TaskComment comment = comments.findByIdAndTaskId(commentId, taskId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "댓글을 찾을 수 없습니다."));
        if (!userId.equals(comment.getAuthor().getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "댓글 작성자만 삭제할 수 있습니다.");
        }
        comments.delete(comment);
        events.publishEvent(new CommentChange(task.getProjectId(), taskId));
    }
}
