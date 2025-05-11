const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.WEB_PORT || 3000;

// 이미지 폴더 존재 확인 및 생성
const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) {
  try {
    console.log('[웹 서버] images 폴더가 없습니다. 폴더를 생성합니다...');
    fs.mkdirSync(imagesDir, { recursive: true });
    console.log(`[웹 서버] images 폴더 생성 완료: ${imagesDir}`);
  } catch (err) {
    console.error(`[웹 서버] 오류: images 폴더 생성 실패: ${err.message}`);
    process.exit(1); // 폴더 생성 실패 시 종료
  }
}

// 이미지 폴더를 정적 파일로 서빙
app.use('/images', express.static(imagesDir));

// 간단한 홈페이지
app.get('/', (req, res) => {
  res.send('Mobi Rank Bot API Server - 이미지 파일을 /images/ 경로에서 접근할 수 있습니다.');
});

// 환경 변수 확인
if (!process.env.SERVER_IP) {
  console.warn('[웹 서버] 경고: SERVER_IP 환경 변수가 설정되지 않았습니다. 기본값 localhost를 사용합니다.');
  process.env.SERVER_IP = 'localhost';
}

// 서버 시작
const server = app.listen(PORT, () => {
  console.log(`[웹 서버] Express 서버가 포트 ${PORT}에서 시작되었습니다 (${new Date().toLocaleString('ko-KR')})`);
  console.log(`[웹 서버] 이미지 접근 URL: http://${process.env.SERVER_IP}:${PORT}/images/example.png`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[웹 서버] 오류: 포트 ${PORT}가 이미 사용 중입니다. 다른 포트를 사용하거나 기존 프로세스를 종료하세요.`);
  } else {
    console.error(`[웹 서버] 오류: 서버 시작 실패: ${err.message}`);
  }
  process.exit(1);
});

// 프로세스 종료 신호 처리
process.on('SIGINT', () => {
  console.log('[웹 서버] SIGINT 신호를 받았습니다. 서버를 종료합니다...');
  server.close(() => {
    console.log('[웹 서버] 서버가 정상적으로 종료되었습니다.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('[웹 서버] SIGTERM 신호를 받았습니다. 서버를 종료합니다...');
  server.close(() => {
    console.log('[웹 서버] 서버가 정상적으로 종료되었습니다.');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error(`[웹 서버] 처리되지 않은 예외: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
