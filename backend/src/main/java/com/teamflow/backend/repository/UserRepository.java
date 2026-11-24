
package com.teamflow.backend.repository;

import com.teamflow.backend.entity.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    interface AccessRow {
        User.Role getRole();
        User.Status getAccountStatus();
        long getAccessRevision();
    }

    interface AdminUserRow extends AccessRow {
        Long getId();
        String getName();
        String getEmail();
    }

    @Query("""
            select account.id as id, account.name as name, account.email as email, account.role as role,
                   account.accountStatus as accountStatus, account.accessRevision as accessRevision
            from User account order by account.id
            """)
    List<AdminUserRow> findAdminUserRows();

    @Query("""
            select account.role as role, account.accountStatus as accountStatus,
                   account.accessRevision as accessRevision from User account where account.id = :id
            """)
    Optional<AccessRow> findAccessById(@Param("id") Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<User> findOneById(Long id);

    @Query(value = """
            SELECT * FROM users WHERE lower(email) = lower(:email)
              AND account_status <> 'WITHDRAWN'
            """, nativeQuery = true)
    Optional<User> findByEmail(@Param("email") String email);

    @Query(value = """
            SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(:email)
              AND account_status <> 'WITHDRAWN')
            """, nativeQuery = true)
    boolean existsByEmail(@Param("email") String email);

    @Transactional
    @Modifying
    @Query("""
            update User account set account.password = :newHash,
                account.accessRevision = account.accessRevision + 1
            where account.id = :userId and account.password = :previousHash
              and account.accessRevision = :revision
            """)
    int updatePassword(@Param("userId") Long userId, @Param("previousHash") String previousHash,
                       @Param("newHash") String newHash, @Param("revision") long revision);
}
