FROM maven:3.9-eclipse-temurin-21 AS backend-build
WORKDIR /build
COPY backend/pom.xml ./
COPY backend/src/main/ ./src/main/
RUN mvn -B -ntp -Dmaven.test.skip=true package

FROM eclipse-temurin:21-jre AS backend
WORKDIR /app
RUN groupadd --gid 10001 teamflow && useradd --uid 10001 --gid 10001 teamflow \
    && install -d -o teamflow -g teamflow -m 0700 /storage/attachments
COPY --from=backend-build /build/target/backend-0.0.1-SNAPSHOT.jar /app/teamflow.jar
USER 10001:10001
ENTRYPOINT ["java", "-jar", "/app/teamflow.jar", "--server.forward-headers-strategy=framework"]

FROM node:24-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/index.html frontend/tsconfig*.json frontend/vite.config.ts ./
COPY frontend/public/ ./public/
COPY frontend/src/ ./src/
RUN npm run build

FROM nginx:stable-alpine AS gateway
COPY deploy/vps/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /build/dist/ /usr/share/nginx/html/
