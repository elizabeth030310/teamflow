package com.teamflow.backend.controller;

import com.teamflow.backend.entity.TaskChecklistItem;
import com.teamflow.backend.repository.TaskChecklistItemRepository;
import com.teamflow.backend.service.ProjectAccess;
import com.teamflow.backend.service.TaskChange;
import jakarta.servlet.http.HttpSession;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

import java.util.List;

@RestController
@RequestMapping("/api/tasks/{taskId}/checklist-items")
public class TaskChecklistController {

    private final ProjectAccess access;
    private final TaskChecklistItemRepository items;
    private final ApplicationEventPublisher events;

    public TaskChecklistController(ProjectAccess access, TaskChecklistItemRepository items,
                                   ApplicationEventPublisher events) {
        this.access = access;
        this.items = items;
        this.events = events;
    }

    public record ItemResponse(Long id, String title, boolean completed) {
        static ItemResponse from(TaskChecklistItem item) {
            return new ItemResponse(item.getId(), item.getTitle(), item.isCompleted());
        }
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<ItemResponse> listItems(@PathVariable Long taskId, HttpSession session) {
        access.requireAccessibleTask(taskId, access.currentUserId(session));
        return items.findByTaskIdOrderByIdAsc(taskId).stream().map(ItemResponse::from).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ItemResponse createItem(@PathVariable Long taskId, @RequestBody JsonNode request, HttpSession session) {
        var task = access.requireAccessibleTask(taskId, access.currentUserId(session));
        JsonNode titleNode = request.get("title");
        String title = titleNode != null && titleNode.isString() ? titleNode.stringValue().strip() : "";
        if (title.isEmpty() || title.codePointCount(0, title.length()) > TaskChecklistItem.MAX_TITLE_LENGTH) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "체크리스트 항목은 1자 이상 200자 이하여야 합니다.");
        }

        TaskChecklistItem item = items.save(new TaskChecklistItem(task, title));
        publishChange(task.getProjectId(), taskId);
        return ItemResponse.from(item);
    }

    @PatchMapping("/{itemId}")
    @Transactional
    public ItemResponse updateItem(@PathVariable Long taskId, @PathVariable Long itemId,
                                   @RequestBody JsonNode request, HttpSession session) {
        var task = access.requireAccessibleTask(taskId, access.currentUserId(session));
        TaskChecklistItem item = requireItem(taskId, itemId);
        JsonNode completed = request.get("completed");
        if (completed == null || !completed.isBoolean()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "완료 여부는 true 또는 false여야 합니다.");
        }

        if (item.isCompleted() != completed.booleanValue()) {
            item.setCompleted(completed.booleanValue());
            publishChange(task.getProjectId(), taskId);
        }
        return ItemResponse.from(item);
    }

    @DeleteMapping("/{itemId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void deleteItem(@PathVariable Long taskId, @PathVariable Long itemId, HttpSession session) {
        var task = access.requireAccessibleTask(taskId, access.currentUserId(session));
        items.delete(requireItem(taskId, itemId));
        publishChange(task.getProjectId(), taskId);
    }

    private void publishChange(Long projectId, Long taskId) {
        events.publishEvent(new TaskChange(projectId, taskId, TaskChange.Type.CHECKLIST_CHANGED));
    }

    private TaskChecklistItem requireItem(Long taskId, Long itemId) {
        return items.findByIdAndTaskId(itemId, taskId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "체크리스트 항목을 찾을 수 없습니다."));
    }
}
