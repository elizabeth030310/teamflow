
package com.teamflow.backend.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDate;

@Entity
@Table(name = "tasks")
public class Task {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 어떤 프로젝트에 속한 작업인지
    private Long projectId;

    // 작업 제목
    private String title;

    // 작업 설명
    private String description;

    // 작업 상태 (TODO, IN_PROGRESS, DONE)
    private String status;

    // 작업 우선순위 (HIGH, MEDIUM, LOW)
    private String priority;

    // 작업 마감일 (예: 2026-11-20)
    private LocalDate dueDate;

    // 기본 생성자
    public Task() {
    }

    // 기존 생성자 (기존 코드와 호환)
    public Task(
            Long projectId,
            String title,
            String description,
            String status) {

        this.projectId = projectId;
        this.title = title;
        this.description = description;
        this.status = status;
        this.priority = "MEDIUM";
        this.dueDate = null;
    }

    // 우선순위와 마감일을 포함한 생성자
    public Task(
            Long projectId,
            String title,
            String description,
            String status,
            String priority,
            LocalDate dueDate) {

        this.projectId = projectId;
        this.title = title;
        this.description = description;
        this.status = status;
        this.priority = priority;
        this.dueDate = dueDate;
    }

    // ID 조회
    public Long getId() {
        return id;
    }

    // 프로젝트 ID 조회
    public Long getProjectId() {
        return projectId;
    }

    // 프로젝트 ID 변경
    public void setProjectId(Long projectId) {
        this.projectId = projectId;
    }

    // 제목 조회
    public String getTitle() {
        return title;
    }

    // 제목 변경
    public void setTitle(String title) {
        this.title = title;
    }

    // 설명 조회
    public String getDescription() {
        return description;
    }

    // 설명 변경
    public void setDescription(String description) {
        this.description = description;
    }

    // 상태 조회
    public String getStatus() {
        return status;
    }

    // 상태 변경
    public void setStatus(String status) {
        this.status = status;
    }

    // 우선순위 조회
    public String getPriority() {
        return priority;
    }

    // 우선순위 변경
    public void setPriority(String priority) {
        this.priority = priority;
    }

    // 마감일 조회
    public LocalDate getDueDate() {
        return dueDate;
    }

    // 마감일 변경
    public void setDueDate(LocalDate dueDate) {
        this.dueDate = dueDate;
    }
}
