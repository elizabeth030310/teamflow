package com.teamflow.backend.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpStatus;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith({OutputCaptureExtension.class, MockitoExtension.class})
class SignupCodeMailerTests {
    @Mock private ObjectProvider<JavaMailSender> sender;
    @Mock private ObjectProvider<BrevoSignupMailTransport> brevo;
    @Mock private JavaMailSender smtpTransport;
    @Mock private BrevoSignupMailTransport brevoTransport;

    @Test
    void logsBrevoAndUsesTheBrevoTransport(CapturedOutput output) {
        when(brevo.getObject()).thenReturn(brevoTransport);

        mailer("brevo").send("recipient@example.test", "012345");

        verify(brevoTransport).send(eq("recipient@example.test"), any(), any());
        verifyNoInteractions(sender);
        assertProviderLog(output, "brevo");
    }

    @Test
    void logsSmtpAndUsesTheLocalSmtpTransport(CapturedOutput output) {
        when(sender.getIfAvailable()).thenReturn(smtpTransport);
        when(sender.getObject()).thenReturn(smtpTransport);

        mailer("smtp").send("recipient@example.test", "012345");

        verify(smtpTransport).send(any(SimpleMailMessage.class));
        verifyNoInteractions(brevo);
        assertProviderLog(output, "smtp");
    }

    @Test
    void rejectsUnsupportedProviderWithoutLoggingItsValue(CapturedOutput output) {
        SignupCodeMailer mailer = mailer("private provider detail\nforged log");

        assertThatThrownBy(mailer::requireAvailable)
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
        verifyNoInteractions(brevo, sender);
        assertProviderLog(output, "unsupported");
        assertThat(output.getAll()).doesNotContain("private provider detail", "forged log");
    }

    private SignupCodeMailer mailer(String provider) {
        return new SignupCodeMailer(sender, brevo, provider, "127.0.0.1", "sender@example.test", false, false);
    }

    private static void assertProviderLog(CapturedOutput output, String provider) {
        assertThat(output.getAll().lines().filter(line -> line.contains("Signup mail provider=")))
                .singleElement().asString().endsWith("Signup mail provider=" + provider);
        assertThat(output.getAll()).doesNotContain("example.test", "012345");
    }
}
