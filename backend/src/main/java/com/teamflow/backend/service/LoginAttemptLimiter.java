package com.teamflow.backend.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.function.LongSupplier;

@Component
public class LoginAttemptLimiter {
    private static final long WINDOW_NANOS = Duration.ofMinutes(1).toNanos();
    private static final int PER_ADDRESS = 20;
    private static final int PER_ACCOUNT = 30;
    private static final int GLOBAL = 300;

    private final LongSupplier nanoTime;
    private final Map<String, Integer> addresses = new HashMap<>();
    private final Map<String, Integer> accounts = new HashMap<>();
    private long windowStarted;
    private int total;

    public LoginAttemptLimiter() {
        this(System::nanoTime);
    }

    LoginAttemptLimiter(LongSupplier nanoTime) {
        this.nanoTime = nanoTime;
        windowStarted = nanoTime.getAsLong();
    }

    public synchronized void reserve(String address, String normalizedEmail) {
        long now = nanoTime.getAsLong();
        if (now - windowStarted >= WINDOW_NANOS) {
            addresses.clear();
            accounts.clear();
            total = 0;
            windowStarted = now;
        }

        if (total >= GLOBAL || addresses.getOrDefault(address, 0) >= PER_ADDRESS
                || accounts.getOrDefault(normalizedEmail, 0) >= PER_ACCOUNT) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS);
        }
        addresses.merge(address, 1, Integer::sum);
        accounts.merge(normalizedEmail, 1, Integer::sum);
        total++;
    }
}
