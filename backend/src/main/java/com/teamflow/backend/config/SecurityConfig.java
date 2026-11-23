
package com.teamflow.backend.config;

import com.teamflow.backend.entity.User;
import com.teamflow.backend.service.AccountAccess;
import jakarta.servlet.DispatcherType;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;

import org.springframework.security.authorization.AuthenticatedAuthorizationManager;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManagers;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.security.web.csrf.CsrfFilter;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http, AccountAccess accounts) throws Exception {

        AuthorizationManager<RequestAuthorizationContext> activeAccount = (authentication, context) -> {
            requireAccount(accounts, context);
            return new AuthorizationDecision(true);
        };

        http
                .csrf(csrf -> csrf.disable())
                .addFilterBefore(new SameOriginRequestFilter(), CsrfFilter.class)

                .authorizeHttpRequests(auth -> auth

                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()

                        .requestMatchers("/api/admin", "/api/admin/**")
                        .access(AuthorizationManagers.allOf(
                                AuthenticatedAuthorizationManager.authenticated(),
                                (authentication, context) ->
                                        new AuthorizationDecision(requireAccount(accounts, context) == User.Role.ADMIN)
                        ))

                        // 오류 응답 처리 허용
                        .dispatcherTypeMatchers(
                                DispatcherType.ERROR,
                                DispatcherType.FORWARD
                        ).permitAll()

                        .requestMatchers("/error").permitAll()

                        // 회원가입, 로그인, 로그아웃은 누구나 요청 가능
                        .requestMatchers(
                                HttpMethod.POST,
                                "/api/auth/signup",
                                "/api/auth/signup/code",
                                "/api/auth/login",
                                "/api/auth/logout"
                        ).permitAll()

                        .anyRequest()
                        .access(AuthorizationManagers.allOf(
                                AuthenticatedAuthorizationManager.authenticated(), activeAccount))
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

    private static User.Role requireAccount(AccountAccess accounts, RequestAuthorizationContext context) {
        return accounts.current(context.getRequest().getSession(false))
                .orElseThrow(() -> new InsufficientAuthenticationException("Account session is no longer valid"))
                .getRole();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
