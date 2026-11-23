package com.teamflow.backend.service;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LoginAttemptLimiterTests {
    @Test
    void limitsOneAddressAndResetsAfterTheWindow() {
        AtomicLong time = new AtomicLong();
        LoginAttemptLimiter limiter = new LoginAttemptLimiter(time::get);
        for (int attempt = 0; attempt < 20; attempt++) {
            limiter.reserve("address", "account-" + attempt);
        }
        expectLimited(() -> limiter.reserve("address", "another-account"));
        limiter.reserve("another-address", "another-account");
        time.addAndGet(Duration.ofMinutes(1).toNanos());
        limiter.reserve("address", "another-account");
    }

    @Test
    void limitsOneAccountAcrossAddresses() {
        LoginAttemptLimiter limiter = new LoginAttemptLimiter(() -> 0L);
        for (int attempt = 0; attempt < 30; attempt++) {
            limiter.reserve("address-" + attempt, "account");
        }
        expectLimited(() -> limiter.reserve("another-address", "account"));
        limiter.reserve("another-address", "another-account");
    }

    private static void expectLimited(Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ResponseStatusException.class,
                exception -> org.assertj.core.api.Assertions.assertThat(exception.getStatusCode())
                        .isEqualTo(HttpStatus.TOO_MANY_REQUESTS));
    }
}
