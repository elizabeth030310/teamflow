
package com.teamflow.backend.repository;

import com.teamflow.backend.entity.Project;
import com.teamflow.backend.entity.ProjectMember.Status;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ProjectRepository extends JpaRepository<Project, Long> {

    // 특정 사용자가 소유한 프로젝트 목록 조회
    List<Project> findByOwnerId(Long ownerId);

    // 특정 사용자가 소유한 프로젝트 하나 조회
    Optional<Project> findByIdAndOwnerId(Long id, Long ownerId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Project> findOneByIdAndOwnerId(Long id, Long ownerId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Project> findLockedById(Long id);

    @Query("""
            select project from Project project
            where project.owner.id = :userId or exists (
                select member.id from ProjectMember member
                where member.project = project and member.user.id = :userId and member.status = :status
            )
            order by project.id
            """)
    List<Project> findAccessibleProjects(@Param("userId") Long userId, @Param("status") Status status);

    @Query("""
            select project from Project project
            where project.id = :projectId and (project.owner.id = :userId or exists (
                select member.id from ProjectMember member
                where member.project = project and member.user.id = :userId and member.status = :status
            ))
            """)
    Optional<Project> findAccessibleProject(@Param("projectId") Long projectId,
            @Param("userId") Long userId, @Param("status") Status status);
}
