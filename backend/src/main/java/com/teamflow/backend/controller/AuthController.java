
package com.teamflow.backend.controller;

import com.teamflow.backend.entity.User;
import com.teamflow.backend.repository.UserRepository;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public AuthController(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder) {

        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    // 회원가입 요청 데이터
    public record SignupRequest(
            @NotBlank(message = "이름을 입력해 주세요.")
            @Size(max = 50, message = "이름은 50자 이하로 입력해 주세요.")
            String name,

            @NotBlank(message = "이메일을 입력해 주세요.")
            @Email(message = "올바른 이메일 형식을 입력해 주세요.")
            String email,

            @NotBlank(message = "비밀번호를 입력해 주세요.")
            @Size(min = 8, message = "비밀번호는 8자 이상이어야 합니다.")
            String password
    ) {
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
        String email = request.email().trim().toLowerCase();

        if (name.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "이름을 입력해 주세요."
            );
        }

        if (userRepository.existsByEmail(email)) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "이미 가입된 이메일입니다."
            );
        }

        String encodedPassword =
                passwordEncoder.encode(request.password());

        User user = new User(
                name,
                email,
                encodedPassword
        );

        User savedUser = userRepository.save(user);

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

        String email = request.email().trim().toLowerCase();

        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED,
                        "이메일 또는 비밀번호가 올바르지 않습니다."
                ));

        if (!passwordEncoder.matches(
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

        return Map.of(
                "id", user.getId(),
                "name", user.getName(),
                "email", user.getEmail(),
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
                "email", user.getEmail()
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
}
