#!/bin/bash

# 로그 디렉토리 생성
mkdir -p logs

# 시간 정보를 포함한 로그 파일명 생성
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="logs/bot_${TIMESTAMP}.log"

echo "봇 시작: $(date) - 로그 파일: ${LOG_FILE}" 

# 노드 프로세스가 이미 실행 중인지 확인
if pgrep -f "node index.js" > /dev/null; then
  echo "경고: 봇이 이미 실행 중입니다. 기존 프로세스를 종료한 후 새로 시작합니다."
  
  # 기존 PID 파일이 있는지 확인과 프로세스 종료
  if [ -f "bot.pid" ]; then
    OLD_PID=$(cat bot.pid)
    if ps -p "$OLD_PID" > /dev/null; then
      echo "PID $OLD_PID 프로세스 종료 중..."
      kill "$OLD_PID"
      sleep 2
      
      # 프로세스가 여전히 살아있는지 확인
      if ps -p "$OLD_PID" > /dev/null; then
        echo "PID $OLD_PID 프로세스가 응답하지 않습니다. 강제 종료 시도 중..."
        kill -9 "$OLD_PID"
        sleep 1
      fi
    fi
  fi
  
  # 그래도 여전히 노드 프로세스가 살아있는지 확인
  if pgrep -f "node index.js" > /dev/null; then
    echo "사용중인 모든 node 프로세스 강제 종료 중..."
    pkill -9 -f "node index.js"
    sleep 1
  fi
fi

# 먼저 deploy-commands.js 실행하여 명령어 등록
echo "Discord 명령어 등록 중..."
node deploy-commands.js 2>&1 | tee -a "${LOG_FILE}"

# 명령어 등록 성공 여부 확인
if [ $? -eq 0 ]; then
  echo "Discord 명령어 등록 완료"
  
  # nohup으로 백그라운드에서 실행하고 로그 저장
  echo "봇 프로세스 시작 중..."
  nohup node index.js >> "${LOG_FILE}" 2>&1 &
else
  echo "Discord 명령어 등록 중 오류 발생. 로그를 확인하세요."
  echo "봇을 시작하시겠습니까? (Y/n)"
  read -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    echo "봇 프로세스 시작 중..."
    nohup node index.js >> "${LOG_FILE}" 2>&1 &
  else
    echo "봇 시작을 취소합니다."
    exit 1
  fi
fi

# 프로세스 ID 저장
BOT_PID=$!
echo "${BOT_PID}" > bot.pid
echo "봇이 백그라운드에서 시작되었습니다. (PID: ${BOT_PID})"
echo "로그확인 : tail -f ${LOG_FILE}"
