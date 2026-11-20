
package com.teamflow.backend.controller;

import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.UserRepository;
import com.teamflow.backend.service.AccountAccess;
import com.teamflow.backend.service.SignupVerificationService;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private static final int BCRYPT_MAX_PASSWORD_BYTES = 72;

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final SignupVerificationService signupVerification;

    public AuthController(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            SignupVerificationService signupVerification) {

        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.signupVerification = signupVerification;
    }

    public record SignupCodeRequest(@NotBlank @Email @Size(max = 255) String email) {
    }

    // 회원가입 요청 데이터
    public record SignupRequest(
            @NotBlank(message = "이름을 입력해 주세요.")
            @Size(max = 50, message = "이름은 50자 이하로 입력해 주세요.")
            String name,

            @NotBlank(message = "이메일을 입력해 주세요.")
            @Email(message = "올바른 이메일 형식을 입력해 주세요.")
            @Size(max = 255)
            String email,

            @NotBlank(message = "비밀번호를 입력해 주세요.")
            @Size(min = 8, message = "비밀번호는 8자 이상이어야 합니다.")
            String password,

            @NotBlank
            @Pattern(regexp = "[0-9]{6}")
            String code
    ) {
    }

    @PostMapping("/signup/code")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Integer> sendSignupCode(
            @Valid @RequestBody SignupCodeRequest request, HttpServletRequest httpRequest) {
        signupVerification.issue(normalizeEmail(request.email()), httpRequest.getRemoteAddr());
        return Map.of("resendAfterSeconds", SignupVerificationService.RESEND_SECONDS);
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String, String> invalidRequest() {
        return Map.of("message", "입력한 정보를 확인해 주세요.");
    }

    // 로그인 요청 데이터
    public record LoginRequest(
            @NotBlank(message = "이메일을 입력해 주세요.")
            String email,

            @NotBlank(message = "비밀번호를 입력해 주세요.")
            String password
    ) {
    }

    // 회원가입
    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> signup(
            @Valid @RequestBody SignupRequest request) {

        String name = request.name().trim();
        String email = normalizeEmail(request.email());

        if (name.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "이름을 입력해 주세요."
            );
        }

        if (exceedsPasswordByteLimit(request.password())) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "비밀번호는 UTF-8 기준 72바이트 이하여야 합니다."
            );
        }

        User savedUser = signupVerification.complete(email, name, request.password(), request.code());

        return Map.of(
                "id", savedUser.getId(),
                "name", savedUser.getName(),
                "email", savedUser.getEmail(),
                "message", "회원가입이 완료되었습니다."
        );
    }

    // 로그인
    @PostMapping("/login")
    public Map<String, Object> login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest httpRequest) {

        String email = request.email().trim().toLowerCase(Locale.ROOT);
        String legacyEmail = request.email().trim().toLowerCase(Locale.getDefault());

        User user = userRepository.findByEmail(email)
                .or(() -> email.equals(legacyEmail) ? Optional.empty() : userRepository.findByEmail(legacyEmail))
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED,
                        "이메일 또는 비밀번호가 올바르지 않습니다."
                ));

        if (user.getAccountStatus() != User.Status.ACTIVE
                || exceedsPasswordByteLimit(request.password()) || !passwordEncoder.matches(
                request.password(),
                user.getPassword())) {

            throw new ResponseStatusException(
                    HttpStatus.UNAUTHORIZED,
                    "이메일 또는 비밀번호가 올바르지 않습니다."
            );
        }

        // 기존 세션 제거
        HttpSession existingSession =
                httpRequest.getSession(false);

        if (existingSession != null) {
            existingSession.invalidate();
        }

        // 새 세션 생성
        HttpSession session = httpRequest.getSession(true);

        // Spring Security 인증 객체 생성
        Authentication authentication =
                new UsernamePasswordAuthenticationToken(
                        user.getEmail(),
                        null,
                        List.of(
                                new SimpleGrantedAuthority("ROLE_USER")
                        )
                );

        // 인증 정보를 SecurityContext에 저장
        SecurityContext securityContext =
                SecurityContextHolder.createEmptyContext();

        securityContext.setAuthentication(authentication);

        SecurityContextHolder.setContext(securityContext);

        // Spring Security가 세션에서 인증 정보를 복원할 수 있도록 저장
        session.setAttribute(
                HttpSessionSecurityContextRepository
                        .SPRING_SECURITY_CONTEXT_KEY,
                securityContext
        );

        // 기존 사용자 ID 세션 정보도 유지
        session.setAttribute("userId", user.getId());
        session.setAttribute(AccountAccess.SESSION_REVISION, user.getAccessRevision());

        return Map.of(
                "id", user.getId(),
                "name", user.getName(),
                "email", user.getEmail(),
                "role", user.getRole().name(),
                "message", "로그인에 성공했습니다."
        );
    }

    // 현재 로그인 사용자 조회
    @GetMapping("/me")
    public Map<String, Object> me(
            HttpServletRequest request) {

        HttpSession session = request.getSession(false);

        if (session == null ||
                session.getAttribute("userId") == null) {

            throw new ResponseStatusException(
                    HttpStatus.UNAUTHORIZED,
                    "로그인이 필요합니다."
            );
        }

        Long userId = (Long) session.getAttribute("userId");

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED,
                        "유효하지 않은 로그인 정보입니다."
                ));

        return Map.of(
                "id", user.getId(),
                "name", user.getName(),
                "email", user.getEmail(),
                "role", user.getRole().name()
        );
    }

    // 로그아웃
    @PostMapping("/logout")
    public Map<String, String> logout(
            HttpServletRequest request) {

        HttpSession session = request.getSession(false);

        if (session != null) {
            session.invalidate();
        }

        SecurityContextHolder.clearContext();

        return Map.of(
                "message", "로그아웃되었습니다."
        );
    }

    public record ChangePasswordRequest(
            @NotBlank String currentPassword,
            @NotBlank String newPassword
    ) {
    }

    @PostMapping(value = "/change-password", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, String> changePassword(
            @Valid @RequestBody ChangePasswordRequest request, HttpServletRequest httpRequest) {
        HttpSession session = httpRequest.getSession(false);
        if (session == null || !(session.getAttribute("userId") instanceof Long userId)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다.");
        }

        String newPassword = request.newPassword();
        if (newPassword.codePointCount(0, newPassword.length()) < 8 || exceedsPasswordByteLimit(newPassword)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "새 비밀번호는 8자 이상, UTF-8 기준 72바이트 이하여야 합니다.");
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED, "유효하지 않은 로그인 정보입니다."));
        String previousHash = user.getPassword();
        if (exceedsPasswordByteLimit(request.currentPassword())
                || !passwordEncoder.matches(request.currentPassword(), previousHash)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "현재 비밀번호가 올바르지 않습니다.");
        }

        if (userRepository.updatePassword(userId, previousHash, passwordEncoder.encode(newPassword),
                AccountAccess.sessionRevision(session)) == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "비밀번호가 변경되었습니다. 다시 로그인해 주세요.");
        }

        session.invalidate();
        SecurityContextHolder.clearContext();
        return Map.of("message", "비밀번호가 변경되었습니다. 다시 로그인해 주세요.");
    }

    private static boolean exceedsPasswordByteLimit(String password) {
        return password.getBytes(StandardCharsets.UTF_8).length > BCRYPT_MAX_PASSWORD_BYTES;
    }

    private static String normalizeEmail(String email) {
        String normalized = email.trim().toLowerCase(Locale.ROOT);
        if (normalized.length() > 255) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        }
        return normalized;
    }
}
