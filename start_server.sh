#!/bin/bash

# 로그 디렉토리 생성
mkdir -p logs

# 시간 정보를 포함한 로그 파일명 생성
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="logs/server_${TIMESTAMP}.log"

echo "웹 서버 시작: $(date) - 로그 파일: ${LOG_FILE}" 

# 노드 프로세스가 이미 실행 중인지 확인
if pgrep -f "node server.js" > /dev/null; then
  echo "경고: 웹 서버가 이미 실행 중입니다. 중복 실행을 막기 위해 종료합니다."
  
  # 기존 프로세스 종료
  pkill -f "node server.js"
  echo "기존 웹 서버 프로세스를 종료했습니다."
  sleep 2  # 프로세스가 완전히 종료될 때까지 대기
fi

# nohup으로 백그라운드에서 실행하고 로그 저장
nohup node server.js >> "${LOG_FILE}" 2>&1 &

# 프로세스 ID 저장
SERVER_PID=$!
echo "${SERVER_PID}" > server.pid
echo "웹 서버가 백그라운드에서 시작되었습니다. (PID: ${SERVER_PID})"
echo "로그를 확인하려면: tail -f ${LOG_FILE}"
