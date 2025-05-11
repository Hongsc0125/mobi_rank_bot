#!/bin/bash

# 로그 디렉토리 생성
mkdir -p logs

# 시간 정보를 포함한 로그 파일명 생성
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="logs/bot_${TIMESTAMP}.log"

echo "봇 시작: $(date) - 로그 파일: ${LOG_FILE}" 

# 노드 프로세스가 이미 실행 중인지 확인
if pgrep -f "node index.js" > /dev/null; then
  echo "경고: 봇이 이미 실행 중입니다. 중복 실행을 막기 위해 종료합니다."
  exit 1
fi

# nohup으로 백그라운드에서 실행하고 로그 저장
nohup node index.js >> "${LOG_FILE}" 2>&1 &

# 프로세스 ID 저장
BOT_PID=$!
echo "${BOT_PID}" > bot.pid
echo "봇이 백그라운드에서 시작되었습니다. (PID: ${BOT_PID})"
echo "로그를 확인하려면: tail -f ${LOG_FILE}"
