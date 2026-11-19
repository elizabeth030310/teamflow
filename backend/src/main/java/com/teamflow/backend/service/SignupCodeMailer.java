package com.teamflow.backend.service;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class SignupCodeMailer {
    private final ObjectProvider<JavaMailSender> sender;
    private final String host;
    private final String from;
    private final boolean secureTransport;

    public SignupCodeMailer(ObjectProvider<JavaMailSender> sender,
                            @Value("${spring.mail.host}") String host,
                            @Value("${teamflow.signup.mail-from}") String from,
                            @Value("${spring.mail.properties.mail.smtp.starttls.required}") boolean startTls,
                            @Value("${spring.mail.properties.mail.smtp.auth}") boolean smtpAuth) {
        this.sender = sender;
        this.host = host;
        this.from = from;
        this.secureTransport = startTls || (!smtpAuth && ("127.0.0.1".equals(host) || "::1".equals(host)));
    }

    public void requireAvailable() {
        if (host.isBlank() || from.isBlank() || !secureTransport || sender.getIfAvailable() == null) {
            throw unavailable();
        }
    }

    public void send(String email, String code) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(email);
        message.setSubject("TeamFlow 회원가입 인증번호");
        message.setText("인증번호는 " + code + "입니다. 5분 안에 입력해 주세요. "
                + "가입을 요청하지 않았다면 이 메일을 무시하셔도 됩니다.");
        try {
            sender.getObject().send(message);
        } catch (MailException | IllegalArgumentException exception) {
            throw unavailable();
        }
    }

    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
    }
}
