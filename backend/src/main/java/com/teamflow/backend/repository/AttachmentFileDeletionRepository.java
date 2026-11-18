package com.teamflow.backend.repository;

import com.teamflow.backend.entity.AttachmentFileDeletion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface AttachmentFileDeletionRepository extends JpaRepository<AttachmentFileDeletion, UUID> {

    List<AttachmentFileDeletion> findTop100ByNextAttemptAtLessThanEqualOrderByNextAttemptAtAsc(Instant cutoff);
}
