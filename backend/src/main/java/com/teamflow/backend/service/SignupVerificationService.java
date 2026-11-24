package com.teamflow.backend.service;

import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;

@Service
public class SignupVerificationService {
    private static final Logger logger = LoggerFactory.getLogger(SignupVerificationService.class);

    public static final int RESEND_SECONDS = 60;
    private static final int EXPIRY_SECONDS = 300;
    private static final int MAX_ATTEMPTS = 5;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final SignupCodeMailer mailer;
    private final TaskExecutor mailExecutor;
    private final SecureRandom random = new SecureRandom();
    private final SecretKeySpec key;

    public SignupVerificationService(JdbcTemplate jdbc, PlatformTransactionManager transactionManager,
                                     UserRepository users, PasswordEncoder passwords, SignupCodeMailer mailer,
                                     @Qualifier("signupMailExecutor") TaskExecutor mailExecutor,
                                     @Value("${teamflow.signup.hmac-key}") String configuredKey) {
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(transactionManager);
        this.users = users;
        this.passwords = passwords;
        this.mailer = mailer;
        this.mailExecutor = mailExecutor;
        this.key = parseKey(configuredKey);
    }

    public void issue(String email, String remoteAddress) {
        requireKey();
        mailer.requireAvailable();
        String emailKey = lookupKey("email", email);
        String addressKey = lookupKey("ip", remoteAddress);
        String code = transaction.execute(status -> {
            reserveSend("ip:" + addressKey, 20);
            reserveSend("email:" + emailKey, 5);
            Challenge previous = lockChallenge(emailKey);
            Instant now = Instant.now();
            if (previous != null && previous.resendAt().isAfter(now)) {
                throw throttled(now, previous.resendAt());
            }
            reserveSend("global", 300);
            boolean registered = users.existsByEmail(email);
            UUID salt = UUID.randomUUID();
            String generated;
            do {
                generated = String.format(Locale.ROOT, "%06d", random.nextInt(1_000_000));
            } while (previous != null && matches(previous, emailKey, generated));
            jdbc.update("""
                    INSERT INTO signup_verifications
                        (email_key, salt, code_mac, expires_at, resend_at, failed_attempts)
                    VALUES (?, ?, ?, ?, ?, 0)
                    ON CONFLICT (email_key) DO UPDATE SET
                        salt = EXCLUDED.salt, code_mac = EXCLUDED.code_mac, expires_at = EXCLUDED.expires_at,
                        resend_at = EXCLUDED.resend_at, failed_attempts = 0
                    """, emailKey, salt, registered ? null : codeMac(emailKey, salt, generated),
                    timestamp(now.plusSeconds(EXPIRY_SECONDS)), timestamp(now.plusSeconds(RESEND_SECONDS)));
            return registered ? null : generated;
        });
        try {
            mailExecutor.execute(() -> {
                if (code != null) {
                    try {
                        mailer.send(email, code);
                    } catch (ResponseStatusException exception) {
                        logger.warn("Signup code delivery failed");
                    }
                }
            });
        } catch (TaskRejectedException exception) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
        }
    }

    public User complete(String email, String name, String password, String code) {
        requireKey();
        String emailKey = lookupKey("email", email);
        User created = transaction.execute(status -> {
            Challenge challenge = lockChallenge(emailKey);
            if (challenge == null || challenge.mac() == null
                    || !challenge.expiresAt().isAfter(Instant.now())) {
                return null;
            }
            if (!matches(challenge, emailKey, code)) {
                int failures = challenge.attempts() + 1;
                jdbc.update("""
                        UPDATE signup_verifications SET failed_attempts = ?, code_mac = ?
                        WHERE email_key = ?
                        """, failures, failures == MAX_ATTEMPTS ? null : challenge.mac(), emailKey);
                return null;
            }
            jdbc.update("UPDATE signup_verifications SET code_mac = NULL WHERE email_key = ?", emailKey);
            return jdbc.query("""
                    INSERT INTO users (name, email, password, created_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT (lower(email)) WHERE account_status <> 'WITHDRAWN'
                    DO NOTHING RETURNING id
                    """, (result, row) -> result.getLong(1),
                    name, email, passwords.encode(password), LocalDateTime.now())
                    .stream().findFirst().flatMap(users::findById).orElse(null);
        });
        if (created == null) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT);
        }
        return created;
    }

    @Scheduled(initialDelay = 3600000, fixedDelay = 3600000)
    public void purgeExpired() {
        if (key != null) {
            jdbc.update("DELETE FROM signup_verifications WHERE expires_at <= CURRENT_TIMESTAMP");
            jdbc.update("DELETE FROM signup_send_limits WHERE window_ends_at <= CURRENT_TIMESTAMP");
        }
    }

    private void reserveSend(String scope, int maximum) {
        Instant now = Instant.now();
        var windows = jdbc.query("""
                INSERT INTO signup_send_limits (scope_key, window_ends_at, sends) VALUES (?, ?, 1)
                ON CONFLICT (scope_key) DO UPDATE SET
                    sends = CASE WHEN signup_send_limits.window_ends_at <= ? THEN 1
                                 ELSE signup_send_limits.sends + 1 END,
                    window_ends_at = CASE WHEN signup_send_limits.window_ends_at <= ? THEN EXCLUDED.window_ends_at
                                          ELSE signup_send_limits.window_ends_at END
                WHERE signup_send_limits.window_ends_at <= ? OR signup_send_limits.sends < ?
                RETURNING window_ends_at
                """, (result, row) -> result.getObject(1, OffsetDateTime.class).toInstant(),
                scope, timestamp(now.plusSeconds(3600)), timestamp(now), timestamp(now), timestamp(now), maximum);
        if (windows.isEmpty()) {
            Instant until = jdbc.query("""
                    SELECT window_ends_at FROM signup_send_limits WHERE scope_key = ?
                    """, (result, row) -> result.getObject(1, OffsetDateTime.class).toInstant(), scope)
                    .stream().findFirst().orElse(now);
            throw throttled(now, until);
        }
    }

    private Challenge lockChallenge(String emailKey) {
        return jdbc.query("""
                SELECT salt, code_mac, expires_at, resend_at, failed_attempts
                FROM signup_verifications WHERE email_key = ? FOR UPDATE
                """, (result, row) -> new Challenge(result.getObject("salt", UUID.class),
                result.getBytes("code_mac"), result.getObject("expires_at", OffsetDateTime.class).toInstant(),
                result.getObject("resend_at", OffsetDateTime.class).toInstant(), result.getInt("failed_attempts")),
                emailKey).stream().findFirst().orElse(null);
    }

    private boolean matches(Challenge challenge, String emailKey, String code) {
        return challenge.mac() != null
                && MessageDigest.isEqual(challenge.mac(), codeMac(emailKey, challenge.salt(), code));
    }

    private String lookupKey(String scope, String value) {
        return HexFormat.of().formatHex(hmac(scope + ":" + value));
    }

    private byte[] codeMac(String emailKey, UUID salt, String code) {
        return hmac("code:" + emailKey + ":" + salt + ":" + code);
    }

    private byte[] hmac(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("HMAC unavailable", exception);
        }
    }

    private void requireKey() {
        if (key == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
        }
    }

    private static SecretKeySpec parseKey(String configured) {
        if (configured.isBlank()) {
            return null;
        }
        try {
            byte[] decoded = Base64.getDecoder().decode(configured);
            if (decoded.length >= 32) {
                return new SecretKeySpec(decoded, "HmacSHA256");
            }
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("Invalid signup HMAC key configuration");
        }
        throw new IllegalStateException("Signup HMAC key must contain at least 32 bytes");
    }

    private static ResponseStatusException throttled(Instant now, Instant until) {
        var headers = new HttpHeaders();
        headers.set(HttpHeaders.RETRY_AFTER, Long.toString(Math.max(1, Duration.between(now, until).toSeconds() + 1)));
        return new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS) {
            @Override
            public HttpHeaders getHeaders() {
                return headers;
            }
        };
    }

    private static OffsetDateTime timestamp(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private record Challenge(UUID salt, byte[] mac, Instant expiresAt, Instant resendAt, int attempts) {
    }
}
