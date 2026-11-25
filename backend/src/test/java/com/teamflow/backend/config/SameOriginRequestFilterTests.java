package com.teamflow.backend.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class SameOriginRequestFilterTests {
    private final SameOriginRequestFilter filter =
            new SameOriginRequestFilter(new BrowserRequestOrigin("https://preview.example, https://app.example"));

    @Test
    void permitsReadRequestsAndSameOriginChanges() throws Exception {
        assertAllowed("GET", null, null, null);
        assertAllowed("OPTIONS", null, null, null);
        assertAllowed("POST", "1", "https://teamflow.example", "same-origin");
        assertAllowed("DELETE", "1", null, null);
    }

    @Test
    void requiresExactFrontendOriginAndSameOriginFetchMetadataAtTheProxy() throws Exception {
        assertAllowed("POST", "1", "https://preview.example", "same-origin");
        assertAllowed("POST", "1", "https://app.example", "same-origin");
        assertDenied("POST", "1", "https://unlisted.example", "same-origin");
        assertDenied("POST", "1", "https://preview.example", null);
        assertDenied("POST", "1", "https://preview.example", "same-site");
        assertDenied("POST", "1", "https://preview.example", "cross-site");
    }

    @Test
    void deniesChangesWithoutTheHeaderOrFromAnotherOrigin() throws Exception {
        assertDenied("POST", null, "https://teamflow.example", "same-origin");
        assertDenied("PUT", "1", "https://other.example", null);
        assertDenied("PATCH", "1", null, "same-site");
        assertDenied("DELETE", "1", "null", null);
    }

    private void assertAllowed(String method, String intent, String origin, String fetchSite) throws Exception {
        assertResult(method, intent, origin, fetchSite, 200);
    }

    private void assertDenied(String method, String intent, String origin, String fetchSite) throws Exception {
        assertResult(method, intent, origin, fetchSite, 403);
    }

    private void assertResult(String method, String intent, String origin, String fetchSite, int status) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(method, "/api/auth/logout");
        request.setScheme("https");
        request.setServerName("teamflow.example");
        request.setServerPort(443);
        if (intent != null) request.addHeader("X-TeamFlow-Request", intent);
        if (origin != null) request.addHeader("Origin", origin);
        if (fetchSite != null) request.addHeader("Sec-Fetch-Site", fetchSite);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(request, response, chain);
        assertThat(response.getStatus()).isEqualTo(status);
        assertThat(chain.getRequest() != null).isEqualTo(status == 200);
    }
}
