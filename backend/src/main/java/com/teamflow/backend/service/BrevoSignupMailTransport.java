package com.teamflow.backend.service;

import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

@Component
@Lazy
class BrevoSignupMailTransport {
    private static final URI ENDPOINT = URI.create("https://api.brevo.com/v3/smtp/email");
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(5);

    private final HttpClient client;
    private final JsonMapper json;
    private final URI endpoint;
    private final Duration requestTimeout;
    private final String apiKey;
    private final String from;

    @Autowired
    BrevoSignupMailTransport(JsonMapper json,
                            @Value("${teamflow.signup.brevo-api-key}") String apiKey,
                            @Value("${teamflow.signup.brevo-from}") String from) {
        this(json, apiKey, from, ENDPOINT, REQUEST_TIMEOUT);
    }

    BrevoSignupMailTransport(JsonMapper json, String apiKey, String from, URI endpoint, Duration requestTimeout) {
        this.json = json;
        this.apiKey = apiKey;
        this.from = from;
        this.endpoint = endpoint;
        this.requestTimeout = requestTimeout;
        this.client = HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    void requireAvailable() {
        if (apiKey.isBlank() || from.isBlank()) {
            throw unavailable();
        }
    }

    void send(String email, String subject, String text) {
        requireAvailable();
        try {
            byte[] payload = json.writeValueAsBytes(Map.of(
                    "sender", Map.of("email", from),
                    "to", List.of(Map.of("email", email)),
                    "subject", subject,
                    "textContent", text));
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                    .timeout(requestTimeout)
                    .header("api-key", apiKey)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                    .build();
            HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = response.body()) {
                if (response.statusCode() != HttpStatus.CREATED.value()) {
                    throw unavailable();
                }
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw unavailable();
        } catch (IOException | IllegalArgumentException | tools.jackson.core.JacksonException exception) {
            throw unavailable();
        }
    }

    @PreDestroy
    void close() {
        client.close();
    }

    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
    }
}
