package com.teamflow.backend.service;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(OutputCaptureExtension.class)
class BrevoSignupMailTransportTests {
    private static final String KEY = "fixture-brevo-key";
    private static final String FROM = "signup@example.test";
    private static final String TO = "\"quoted\"@example.test";
    private static final String SUBJECT = "TeamFlow 회원가입 인증번호";
    private static final String TEXT = "인증번호는 012345입니다.\n5분 안에 입력해 주세요.";

    private final JsonMapper json = JsonMapper.builder().build();
    private HttpServer server;
    private URI endpoint;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        endpoint = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v3/smtp/email");
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void sendsUtf8JsonAndAccepts201() {
        AtomicReference<Request> captured = new AtomicReference<>();
        server.createContext("/v3/smtp/email", exchange -> {
            try (exchange) {
                captured.set(new Request(exchange.getRequestMethod(), exchange.getRequestURI().toString(),
                        exchange.getRequestHeaders().getFirst("api-key"),
                        exchange.getRequestHeaders().getFirst("Content-Type"),
                        exchange.getRequestHeaders().getFirst("Accept"),
                        json.readTree(exchange.getRequestBody().readAllBytes())));
                exchange.sendResponseHeaders(201, -1);
            }
        });

        withTransport(KEY, FROM, Duration.ofSeconds(5), transport -> transport.send(TO, SUBJECT, TEXT));

        Request request = captured.get();
        assertThat(request).isNotNull();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.path()).isEqualTo("/v3/smtp/email");
        assertThat(request.key()).isEqualTo(KEY);
        assertThat(request.contentType()).isEqualTo("application/json");
        assertThat(request.accept()).isEqualTo("application/json");
        assertThat(request.payload().at("/sender/email").asString()).isEqualTo(FROM);
        assertThat(request.payload().at("/to/0/email").asString()).isEqualTo(TO);
        assertThat(request.payload().at("/subject").asString()).isEqualTo(SUBJECT);
        assertThat(request.payload().at("/textContent").asString()).isEqualTo(TEXT);
    }

    @ParameterizedTest
    @ValueSource(ints = {200, 202, 307, 400, 401, 429, 500})
    void rejectsAllOtherStatusesWithoutExposingTheResponse(int status, CapturedOutput output) {
        server.createContext("/v3/smtp/email", exchange -> {
            try (exchange) {
                exchange.getRequestBody().readAllBytes();
                exchange.getResponseHeaders().set("Location", "/redirected");
                byte[] body = (KEY + " " + TEXT).getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(status, body.length);
                exchange.getResponseBody().write(body);
            }
        });
        server.createContext("/redirected", exchange -> {
            try (exchange) {
                exchange.sendResponseHeaders(201, -1);
            }
        });
        withTransport(KEY, FROM, Duration.ofSeconds(5),
                transport -> assertUnavailable(() -> transport.send(TO, SUBJECT, TEXT)));
        assertSafeLog(output, "http_status status=" + status);
    }

    @Test
    void timesOutWhileWaitingForResponseHeaders(CapturedOutput output) {
        CountDownLatch received = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        server.createContext("/v3/smtp/email", exchange -> {
            try (exchange) {
                exchange.getRequestBody().readAllBytes();
                received.countDown();
                release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            }
        });
        try {
            withTransport(KEY, FROM, Duration.ofSeconds(1),
                    transport -> assertUnavailable(() -> transport.send(TO, SUBJECT, TEXT)));
            assertThat(received.getCount()).isZero();
            assertSafeLog(output, "request_timeout");
        } finally {
            release.countDown();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"connect_timeout", "io", "interrupted", "invalid_argument"})
    void classifiesHttpClientFailures(String type, CapturedOutput output) throws Exception {
        HttpClient client = mock(HttpClient.class);
        Exception failure = switch (type) {
            case "connect_timeout" -> new HttpConnectTimeoutException("private exception detail");
            case "io" -> new IOException("private exception detail");
            case "interrupted" -> new InterruptedException("private exception detail");
            case "invalid_argument" -> new IllegalArgumentException("private exception detail");
            default -> throw new AssertionError(type);
        };
        when(client.send(any(), any())).thenThrow(failure);
        BrevoSignupMailTransport transport = new BrevoSignupMailTransport(
                json, KEY, FROM, endpoint, Duration.ofSeconds(5), client);

        try {
            assertUnavailable(() -> transport.send(TO, SUBJECT, TEXT));
            assertThat(Thread.currentThread().isInterrupted()).isEqualTo("interrupted".equals(type));
            assertSafeLog(output, type);
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void classifiesSerializationFailure(CapturedOutput output) {
        JsonMapper failingMapper = mock(JsonMapper.class);
        when(failingMapper.writeValueAsBytes(any())).thenThrow(mock(JacksonException.class));
        BrevoSignupMailTransport transport = new BrevoSignupMailTransport(
                failingMapper, KEY, FROM, endpoint, Duration.ofSeconds(5), mock(HttpClient.class));

        assertUnavailable(() -> transport.send(TO, SUBJECT, TEXT));
        assertSafeLog(output, "serialization");
    }

    @Test
    void rejectsMissingCredentialsBeforeSending() {
        withTransport("", FROM, Duration.ofSeconds(5), transport -> assertUnavailable(transport::requireAvailable));
        withTransport(KEY, "", Duration.ofSeconds(5), transport -> assertUnavailable(transport::requireAvailable));
    }

    private void withTransport(String key, String from, Duration timeout,
                               java.util.function.Consumer<BrevoSignupMailTransport> action) {
        BrevoSignupMailTransport transport = new BrevoSignupMailTransport(json, key, from, endpoint, timeout);
        try {
            action.accept(transport);
        } finally {
            transport.close();
        }
    }

    private static void assertSafeLog(CapturedOutput output, String expected) {
        assertThat(output.getAll().lines()
                .filter(line -> line.contains("BrevoSignupMailTransport") || line.startsWith("\tat ")))
                .singleElement().asString().endsWith("Brevo signup mail failed: type=" + expected);
        assertThat(output.getAll()).doesNotContain(KEY, FROM, "example.test", "012345", SUBJECT,
                "private exception detail");
    }

    private static void assertUnavailable(Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
            assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            assertThat(exception.getReason()).isNull();
            assertThat(exception.getCause()).isNull();
        });
    }

    private record Request(String method, String path, String key, String contentType, String accept, JsonNode payload) {
    }
}
