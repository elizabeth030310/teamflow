
package com.teamflow.backend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 사용자 이름
    @Column(nullable = false, length = 50)
    private String name;

    // 이메일: 중복 가입 방지
    @Column(nullable = false, unique = true, length = 255)
    private String email;

    // 암호화된 비밀번호 저장
    @Column(nullable = false)
    private String password;

    // 가입 날짜
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    // JPA 기본 생성자
    public User() {
    }

    // 회원가입 시 사용하는 생성자
    public User(String name, String email, String password) {
        this.name = name;
        this.email = email;
        this.password = password;
    }

    // 최초 저장 시 가입 날짜 자동 생성
    @jakarta.persistence.PrePersist
    public void prePersist() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
