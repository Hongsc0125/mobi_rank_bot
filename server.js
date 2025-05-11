const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.WEB_PORT || 3000;

// 이미지 폴더를 정적 파일로 서빙
app.use('/images', express.static(path.join(__dirname, 'images')));

// 간단한 홈페이지
app.get('/', (req, res) => {
  res.send('Mobi Rank Bot API Server - 이미지 파일을 /images/ 경로에서 접근할 수 있습니다.');
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`[웹 서버] Express 서버가 포트 ${PORT}에서 시작되었습니다 (${new Date().toLocaleString('ko-KR')})`);
  // console.log(`[웹 서버] 이미지 접근 URL: http://localhost:${PORT}/images/example.png`);
});
