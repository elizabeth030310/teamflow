FROM maven:3.9-eclipse-temurin-21 AS backend-build
WORKDIR /build
COPY backend/pom.xml ./
COPY backend/src/main/ ./src/main/
RUN mvn -B -ntp -Dmaven.test.skip=true package

FROM node:24-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/index.html frontend/tsconfig*.json frontend/vite.config.ts ./
COPY frontend/public/ ./public/
COPY frontend/src/ ./src/
RUN npm run build

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache bash ca-certificates nginx \
    && addgroup -g 10001 teamflow \
    && adduser -D -H -u 10001 -G teamflow teamflow \
    && install -d -o teamflow -g teamflow /tmp/teamflow-nginx
WORKDIR /app
COPY --from=backend-build /build/target/backend-0.0.1-SNAPSHOT.jar /app/teamflow.jar
COPY --from=frontend-build /build/dist/ /app/public/
COPY deploy/render/nginx.conf /app/nginx.conf
COPY deploy/render/start.sh /app/start.sh
RUN sed -i 's/\r$//' /app/start.sh
USER 10001:10001
ENV SPRING_PROFILES_ACTIVE=prod SERVER_ADDRESS=127.0.0.1 \
    SERVER_FORWARD_HEADERS_STRATEGY=framework \
    TEAMFLOW_PROD_DB_SSL_ROOT_CERT=/etc/ssl/certs/ca-certificates.crt \
    TEAMFLOW_ATTACHMENT_STORAGE_ROOT="" \
    TEAMFLOW_ATTACHMENTS_CLEANUP_DELAY_MS=1800000 \
    SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE=0 SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE=4 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=45.0 -XX:ActiveProcessorCount=2" PORT=10000
EXPOSE 10000
ENTRYPOINT ["/bin/bash", "/app/start.sh"]
