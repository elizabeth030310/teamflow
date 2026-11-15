package com.teamflow.backend.service;

import jakarta.annotation.PreDestroy;
import jakarta.servlet.http.HttpSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
public class ProjectEventStreams {
    private static final Logger LOG = LoggerFactory.getLogger(ProjectEventStreams.class);
    private static final int MAX_STREAMS = 128;
    private static final int MAX_PENDING_EVENTS = 32;
    private static final long HEARTBEAT_NANOS = Duration.ofSeconds(15).toNanos();
    private static final long STREAM_TIMEOUT_MS = Duration.ofMinutes(5).toMillis();

    private final Set<Subscription> subscriptions = ConcurrentHashMap.newKeySet();
    private final ExecutorService deliveryThreads = Executors.newVirtualThreadPerTaskExecutor();
    private final ProjectAccess access;

    public ProjectEventStreams(ProjectAccess access) {
        this.access = access;
    }

    public synchronized SseEmitter subscribe(Long projectId, Long userId, HttpSession session) {
        if (subscriptions.size() >= MAX_STREAMS) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
        }
        Subscription subscription = new Subscription(projectId, userId, session);
        SseEmitter emitter = subscription.emitter;
        emitter.onCompletion(() -> subscriptions.remove(subscription));
        emitter.onTimeout(() -> close(subscription));
        emitter.onError(error -> subscriptions.remove(subscription));
        subscriptions.add(subscription);
        return emitter;
    }

    @TransactionalEventListener
    public void onTaskChange(TaskChange event) {
        enqueue(event.projectId(), new PendingEvent("task-changed", event));
    }

    @TransactionalEventListener
    public void onCommentChange(CommentChange event) {
        enqueue(event.projectId(), new PendingEvent("comment-changed", event));
    }

    @TransactionalEventListener
    public void onActivityChange(ProjectActivityChange event) {
        enqueue(event.projectId(), new PendingEvent("activity-changed", event));
    }

    private void enqueue(Long projectId, PendingEvent event) {
        for (Subscription subscription : subscriptions) {
            if (subscription.projectId.equals(projectId) && !subscription.pending.offer(event)) {
                subscription.overflow.set(true);
            }
        }
    }

    @Scheduled(fixedDelay = 1000)
    public void deliver() {
        for (Subscription subscription : subscriptions) {
            if (subscription.delivering.compareAndSet(false, true)) {
                deliveryThreads.execute(() -> deliverSafely(subscription));
            }
        }
    }

    @PreDestroy
    void stopDelivery() {
        deliveryThreads.shutdownNow();
    }

    private void deliverSafely(Subscription subscription) {
        try {
            deliver(subscription);
        } catch (IOException exception) {
            subscriptions.remove(subscription);
        } catch (ResponseStatusException | IllegalStateException exception) {
            close(subscription);
        } catch (RuntimeException exception) {
            LOG.warn("Closing project event stream after a delivery failure", exception);
            close(subscription);
        } finally {
            subscription.delivering.set(false);
        }
    }

    private void deliver(Subscription subscription) throws IOException {
        if (subscription.overflow.get() || !hasSession(subscription)) {
            close(subscription);
            return;
        }

        for (int delivered = 0; delivered < MAX_PENDING_EVENTS; delivered++) {
            PendingEvent event = subscription.pending.poll();
            if (event == null) {
                break;
            }
            send(subscription, SseEmitter.event().name(event.name()).data(event.data(), MediaType.APPLICATION_JSON));
        }
        if (System.nanoTime() - subscription.nextHeartbeat >= 0) {
            send(subscription, SseEmitter.event().comment("heartbeat"));
            subscription.nextHeartbeat = System.nanoTime() + HEARTBEAT_NANOS;
        }
    }

    private void send(Subscription subscription, SseEmitter.SseEventBuilder event) throws IOException {
        access.requireAccessible(subscription.projectId, subscription.userId);
        if (!hasSession(subscription) || subscription.overflow.get() || !subscriptions.contains(subscription)) {
            throw new IllegalStateException("Project event stream is closed");
        }
        subscription.emitter.send(event);
    }

    private boolean hasSession(Subscription subscription) {
        return subscription.userId.equals(subscription.session.getAttribute("userId"));
    }

    private void close(Subscription subscription) {
        if (subscriptions.remove(subscription)) {
            subscription.emitter.complete();
        }
    }

    private record PendingEvent(String name, Object data) {
    }

    private static final class Subscription {
        private final Long projectId;
        private final Long userId;
        private final HttpSession session;
        private final SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
        private final ArrayBlockingQueue<PendingEvent> pending = new ArrayBlockingQueue<>(MAX_PENDING_EVENTS);
        private final AtomicBoolean overflow = new AtomicBoolean();
        private final AtomicBoolean delivering = new AtomicBoolean();
        private long nextHeartbeat = System.nanoTime();

        private Subscription(Long projectId, Long userId, HttpSession session) {
            this.projectId = projectId;
            this.userId = userId;
            this.session = session;
        }
    }
}
