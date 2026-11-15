package com.teamflow.backend.repository;

import com.teamflow.backend.entity.ProjectMember;
import com.teamflow.backend.entity.ProjectMember.Status;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.util.List;
import java.util.Optional;

public interface ProjectMemberRepository extends JpaRepository<ProjectMember, Long> {

    boolean existsByProjectIdAndUserId(Long projectId, Long userId);

    @EntityGraph(attributePaths = "user")
    List<ProjectMember> findByProjectIdAndStatusOrderById(Long projectId, Status status);

    @EntityGraph(attributePaths = "user")
    List<ProjectMember> findByProjectIdOrderById(Long projectId);

    @EntityGraph(attributePaths = {"project", "user"})
    List<ProjectMember> findByUserIdAndStatusOrderById(Long userId, Status status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<ProjectMember> findByIdAndUserId(Long id, Long userId);
}
