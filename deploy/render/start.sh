#!/bin/bash
set -eu

if [[ ! ${PORT:-} =~ ^[0-9]{4,5}$ ]] || (( 10#$PORT < 1024 || 10#$PORT > 65535 || 10#$PORT == 8081 )); then
    echo 'Set PORT to an unprivileged port other than 8081.' >&2
    exit 1
fi

export TEAMFLOW_ATTACHMENT_STORAGE_ROOT=''

mkdir -p /tmp/teamflow-nginx

sed "s/__PORT__/$PORT/g" /app/nginx.conf > /tmp/teamflow-nginx/default.conf
nginx -e stderr -t -c /tmp/teamflow-nginx/default.conf

java -jar /app/teamflow.jar &
backend_pid=$!
gateway_pid=''

stop_services() {
    if [[ -n $gateway_pid ]]; then
        kill -QUIT "$gateway_pid" 2>/dev/null || true
    fi
    kill -TERM "$backend_pid" 2>/dev/null || true
    wait || true
}
trap stop_services EXIT
trap 'exit 0' TERM INT

ready=false
for attempt in {1..120}; do
    kill -0 "$backend_pid" 2>/dev/null || exit 1
    if (echo > /dev/tcp/127.0.0.1/8081) 2>/dev/null; then
        ready=true
        break
    fi
    sleep 1
done
[[ $ready == true ]] || exit 1

nginx -e stderr -c /tmp/teamflow-nginx/default.conf -g 'daemon off;' &
gateway_pid=$!
wait -n "$backend_pid" "$gateway_pid"
exit 1
