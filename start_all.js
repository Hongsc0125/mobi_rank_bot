/**
 * 서버와 봇을 함께 시작하는 통합 스크립트
 * 
 * 사용법: node start_all.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 로그 디렉토리 생성
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// 현재 시간 기반 로그 파일명 생성
const timestamp = new Date().toISOString().replace(/[:.]/g, '_');
const botLogFile = path.join(logsDir, `bot_${timestamp}.log`);
const serverLogFile = path.join(logsDir, `server_${timestamp}.log`);

// 봇 로그 파일 스트림 생성
const botLogStream = fs.createWriteStream(botLogFile, { flags: 'a' });
const serverLogStream = fs.createWriteStream(serverLogFile, { flags: 'a' });

console.log(`[시작 관리자] ${new Date().toLocaleString('ko-KR')} - 통합 시작 스크립트 실행`);
console.log(`[시작 관리자] 봇 로그: ${botLogFile}`);
console.log(`[시작 관리자] 서버 로그: ${serverLogFile}`);

// 기존 프로세스 확인 및 종료 함수 - Ubuntu 환경용
const checkAndKillProcess = (processName, pidFile) => {
  try {
    // Ubuntu/Linux에서 PS 명령어로 프로세스 확인
    const { execSync } = require('child_process');
    
    // PID 파일이 있으면 해당 프로세스 확인 및 종료 시도
    if (fs.existsSync(pidFile)) {
      const pid = fs.readFileSync(pidFile, 'utf8').trim();
      
      // 프로세스가 존재하는지 확인
      try {
        execSync(`ps -p ${pid} -o pid=`);
        console.log(`[시작 관리자] 기존 ${processName} 프로세스 (PID: ${pid})가 발견되었습니다.`);
        
        // 프로세스 종료
        execSync(`kill -15 ${pid}`);
        console.log(`[시작 관리자] PID ${pid}의 ${processName} 프로세스를 종료했습니다.`);
        
        // 강제 종료가 필요한지 확인 (2초 후)
        setTimeout(() => {
          try {
            execSync(`ps -p ${pid} -o pid=`);
            console.log(`[시작 관리자] ${processName} 프로세스가 종료되지 않았습니다. 강제 종료를 시도합니다.`);
            execSync(`kill -9 ${pid}`);
            console.log(`[시작 관리자] PID ${pid}의 ${processName} 프로세스를 강제로 종료했습니다.`);
          } catch (e) {
            // 프로세스가 이미 종료됨
          }
        }, 2000);
      } catch (e) {
        // 프로세스가 존재하지 않음
        console.log(`[시작 관리자] PID ${pid}의 ${processName} 프로세스가 정상적으로 종료되었거나 실행 중이 아닙니다.`);
      }
    } else {
      // 명령어로 검색
      const scriptName = processName === '봇' ? 'index.js' : 'server.js';
      try {
        const result = execSync(`ps aux | grep "node ${scriptName}" | grep -v grep`).toString();
        if (result) {
          console.log(`[시작 관리자] 기존 ${processName} 프로세스가 발견되었지만 PID 파일이 없습니다.`);
          const pidMatch = result.match(/\s+(\d+)\s+/);
          if (pidMatch && pidMatch[1]) {
            const pid = pidMatch[1];
            execSync(`kill -15 ${pid}`);
            console.log(`[시작 관리자] PID ${pid}의 ${processName} 프로세스를 종료했습니다.`);
          }
        }
      } catch (e) {
        // 프로세스를 찾지 못함
      }
    }
  } catch (e) {
    console.error(`[시작 관리자] 프로세스 확인 중 오류: ${e.message}`);
  }
};

// 기존 프로세스 종료 시도
checkAndKillProcess('봇', path.join(__dirname, 'bot.pid'));
checkAndKillProcess('웹 서버', path.join(__dirname, 'server.pid'));

// Discord 봇 시작
console.log('[시작 관리자] Discord 봇을 시작합니다...');
const botProcess = spawn('node', ['index.js'], {
  cwd: __dirname,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

// PID 저장
fs.writeFileSync(path.join(__dirname, 'bot.pid'), botProcess.pid.toString());
console.log(`[시작 관리자] Discord 봇이 시작되었습니다. (PID: ${botProcess.pid})`);

// 출력 스트림 연결
botProcess.stdout.pipe(botLogStream);
botProcess.stderr.pipe(botLogStream);

// 봇 프로세스 이벤트 리스너
botProcess.on('error', (err) => {
  console.error(`[시작 관리자] 봇 시작 오류: ${err.message}`);
  botLogStream.write(`[ERROR] ${new Date().toLocaleString('ko-KR')} - ${err.message}\n`);
});

botProcess.on('close', (code) => {
  console.log(`[시작 관리자] 봇 프로세스가 종료되었습니다. (코드: ${code})`);
  botLogStream.write(`[INFO] ${new Date().toLocaleString('ko-KR')} - 프로세스가 종료되었습니다. (코드: ${code})\n`);
  botLogStream.end();
});

// Express 서버 시작
console.log('[시작 관리자] Express 웹 서버를 시작합니다...');
const serverProcess = spawn('node', ['server.js'], {
  cwd: __dirname,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

// PID 저장
fs.writeFileSync(path.join(__dirname, 'server.pid'), serverProcess.pid.toString());
console.log(`[시작 관리자] Express 웹 서버가 시작되었습니다. (PID: ${serverProcess.pid})`);

// 출력 스트림 연결
serverProcess.stdout.pipe(serverLogStream);
serverProcess.stderr.pipe(serverLogStream);

// 서버 프로세스 이벤트 리스너
serverProcess.on('error', (err) => {
  console.error(`[시작 관리자] 웹 서버 시작 오류: ${err.message}`);
  serverLogStream.write(`[ERROR] ${new Date().toLocaleString('ko-KR')} - ${err.message}\n`);
});

serverProcess.on('close', (code) => {
  console.log(`[시작 관리자] 웹 서버 프로세스가 종료되었습니다. (코드: ${code})`);
  serverLogStream.write(`[INFO] ${new Date().toLocaleString('ko-KR')} - 프로세스가 종료되었습니다. (코드: ${code})\n`);
  serverLogStream.end();
});

// 프로세스 독립적으로 실행 가능하게 함 (부모 프로세스가 종료되어도 계속 실행)
botProcess.unref();
serverProcess.unref();

console.log('[시작 관리자] 모든 서비스가 시작되었습니다.');
