package com.teamflow.backend.entity;

import jakarta.persistence.*;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

@Entity
@Table(name = "task_checklist_items", indexes = @Index(
        name = "idx_task_checklist_items_task_id", columnList = "task_id, id"))
public class TaskChecklistItem {

    public static final int MAX_TITLE_LENGTH = 200;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_task_checklist_items_task"))
    @OnDelete(action = OnDeleteAction.CASCADE)
    private Task task;

    @Column(nullable = false, length = MAX_TITLE_LENGTH)
    private String title;

    @Column(nullable = false)
    private boolean completed;

    protected TaskChecklistItem() {
    }

    public TaskChecklistItem(Task task, String title) {
        this.task = task;
        this.title = title;
    }

    public Long getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public boolean isCompleted() {
        return completed;
    }

    public void setCompleted(boolean completed) {
        this.completed = completed;
    }
}
