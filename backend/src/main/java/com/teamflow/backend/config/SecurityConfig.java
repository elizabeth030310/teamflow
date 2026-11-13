
package com.teamflow.backend.config;

import jakarta.servlet.DispatcherType;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;

import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http) throws Exception {

        http
                // 개발 중 임시 설정
                // 이후 단계에서 CSRF 보호 적용 예정
                .csrf(csrf -> csrf.disable())

                .authorizeHttpRequests(auth -> auth

                        // 오류 응답 처리 허용
                        .dispatcherTypeMatchers(
                                DispatcherType.ERROR,
                                DispatcherType.FORWARD
                        ).permitAll()

                        .requestMatchers("/error").permitAll()

                        // 브라우저 사전 요청 허용
                        .requestMatchers(
                                HttpMethod.OPTIONS,
                                "/**"
                        ).permitAll()

                        // 회원가입, 로그인, 로그아웃은 누구나 요청 가능
                        .requestMatchers(
                                HttpMethod.POST,
                                "/api/auth/signup",
                                "/api/auth/login",
                                "/api/auth/logout"
                        ).permitAll()

                        // 그 외 인증 API는 로그인 필요
                        .requestMatchers("/api/auth/**")
                        .authenticated()

                        // 프로젝트와 작업 API는 로그인 필요
                        .requestMatchers("/api/projects/**")
                        .authenticated()

                        .requestMatchers("/api/tasks/**")
                        .authenticated()

                        // 나머지 요청도 로그인 필요
                        .anyRequest()
                        .authenticated()
                )

                // 기본 로그인 화면 비활성화
                .formLogin(form -> form.disable())

                // HTTP Basic 인증 비활성화
                .httpBasic(basic -> basic.disable())

                // 인증되지 않은 요청은 401 반환
                .exceptionHandling(exception -> exception
                        .authenticationEntryPoint(
                                (request, response, authException) ->
                                        response.sendError(
                                                HttpStatus.UNAUTHORIZED.value()
                                        )
                        )
                );

        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
