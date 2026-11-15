package com.teamflow.backend.service;

import com.teamflow.backend.entity.TaskActivity;
import com.teamflow.backend.repository.TaskActivityRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TaskActivityRecorder {
    private final TaskActivityRepository activities;
    private final ApplicationEventPublisher events;

    public TaskActivityRecorder(TaskActivityRepository activities, ApplicationEventPublisher events) {
        this.activities = activities;
        this.events = events;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(TaskActivity activity) {
        activities.save(activity);
        events.publishEvent(new ProjectActivityChange(activity.getProjectId()));
    }
}
