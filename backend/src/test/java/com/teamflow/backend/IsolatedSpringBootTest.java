package com.teamflow.backend;

import org.springframework.boot.test.context.SpringBootTest;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@SpringBootTest(properties = {
        "spring.datasource.url=${TEAMFLOW_TEST_DB_URL}",
        "spring.datasource.username=teamflow_test",
        "spring.datasource.password=${TEAMFLOW_TEST_DB_PASSWORD}",
        "spring.jpa.hibernate.ddl-auto=update",
        "spring.jpa.defer-datasource-initialization=true",
        "spring.sql.init.mode=always",
        "spring.sql.init.schema-locations=file:db/187-2-notifications.sql,file:db/189-a3-signup-verification.sql,file:db/191-a-task-comment-replies.sql,file:db/191-c-comment-reply-notifications.sql",
        "teamflow.attachments.storage-root=",
        "teamflow.signup.hmac-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        "spring.mail.host=",
        "spring.mail.test-connection=false"
})
@interface IsolatedSpringBootTest {
}
