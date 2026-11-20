
package com.teamflow.backend.repository;

import com.teamflow.backend.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    // 이메일로 회원 조회
    Optional<User> findByEmail(String email);

    // 이메일 중복 여부 확인
    boolean existsByEmail(String email);

    @Transactional
    @Modifying
    @Query("""
            update User account set account.password = :newHash
            where account.id = :userId and account.password = :previousHash
            """)
    int updatePassword(@Param("userId") Long userId, @Param("previousHash") String previousHash,
                       @Param("newHash") String newHash);
}
