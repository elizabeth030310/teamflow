package com.teamflow.backend.service;

import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.UserRepository;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
public class AccountAccess {
    public static final String SESSION_REVISION = "accessRevision";
    private final UserRepository users;

    public AccountAccess(UserRepository users) {
        this.users = users;
    }

    public Optional<UserRepository.AccessRow> current(HttpSession session) {
        if (session == null || !(session.getAttribute("userId") instanceof Long userId)) {
            return Optional.empty();
        }
        long revision = sessionRevision(session);
        return users.findAccessById(userId)
                .filter(account -> account.getAccountStatus() == User.Status.ACTIVE
                        && account.getAccessRevision() == revision);
    }

    public static long sessionRevision(HttpSession session) {
        return session.getAttribute(SESSION_REVISION) instanceof Long revision ? revision : 0;
    }
}
