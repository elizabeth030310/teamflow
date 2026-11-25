package com.teamflow.backend.config;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.cors.CorsUtils;

import java.net.URI;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public final class BrowserRequestOrigin {
    private final Set<String> frontendOrigins;

    public BrowserRequestOrigin(@Value("${TEAMFLOW_FRONTEND_ORIGINS:}") String configuredOrigins) {
        frontendOrigins = Arrays.stream(configuredOrigins.split(","))
                .map(String::strip)
                .filter(origin -> !origin.isEmpty())
                .map(BrowserRequestOrigin::requireHttpsOrigin)
                .collect(Collectors.toUnmodifiableSet());
    }

    public boolean isAllowed(HttpServletRequest request) {
        try {
            return !CorsUtils.isCorsRequest(request)
                    || ("same-origin".equals(request.getHeader("Sec-Fetch-Site"))
                    && frontendOrigins.contains(request.getHeader("Origin")));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static String requireHttpsOrigin(String origin) {
        URI uri = URI.create(origin);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null
                || !origin.equals("https://" + uri.getHost())) {
            throw new IllegalArgumentException("TEAMFLOW_FRONTEND_ORIGINS requires exact HTTPS origins without paths or ports");
        }
        return origin;
    }
}
