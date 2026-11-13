
package com.teamflow.backend.repository;

import com.teamflow.backend.entity.Project;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ProjectRepository extends JpaRepository<Project, Long> {

    // 특정 사용자가 소유한 프로젝트 목록 조회
    List<Project> findByOwnerId(Long ownerId);

    // 특정 사용자가 소유한 프로젝트 하나 조회
    Optional<Project> findByIdAndOwnerId(Long id, Long ownerId);
}
