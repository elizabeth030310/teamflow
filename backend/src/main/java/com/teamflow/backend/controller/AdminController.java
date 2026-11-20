package com.teamflow.backend.controller;

import com.teamflow.backend.repository.UserRepository;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final UserRepository users;

    public AdminController(UserRepository users) {
        this.users = users;
    }

    public record Summary(long userCount) {
    }

    @GetMapping("/summary")
    public ResponseEntity<Summary> summary() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new Summary(users.count()));
    }
}
