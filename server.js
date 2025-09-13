const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { sendToChannel, sendToChannelTest } = require('./index');
require('dotenv').config();

// 데이터베이스 연결 테스트 모듈
const { testConnection } = require('./db/session');

const { 
  sendDiscordMessage,
  getMessage,
  buildPatchNoteComponents 
} = require('./utils/post_patch_note');

const app = express();
const PORT = process.env.WEB_PORT || 3000;
const PATCH_NOTE_WEBHOOK_URL = process.env.PATCH_NOTE_WEBHOOK_URL;

// JSON 파싱 미들웨어 추가
app.use(express.json());

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


// 기존 패치노트 API 엔드포인트
app.get('/api/patch_note', async (req, res) => {
  try {
    await sendToChannel();
    
    res.json({
      success: true,
      message: '포럼 게시글이 성공적으로 전송되었습니다.'
    });
  } catch (error) {
    console.error('[포럼 게시글 전송 오류]', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// 테스트용 임베드 패치노트 API 엔드포인트 추가
app.get('/api/patch_note_test', async (req, res) => {
  try {
    // 테스트용 임베드 함수 호출
    const result = await sendToChannelTest();
    
    res.json({
      success: true,
      message: '테스트용 패치노트가 성공적으로 전송되었습니다.',
      threadId: result
    });
  } catch (error) {
    console.error('[테스트 패치노트 전송 오류]', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


// 환경 변수 확인
if (!process.env.SERVER_IP) {
  console.warn('[웹 서버] 경고: SERVER_IP 환경 변수가 설정되지 않았습니다. 기본값 localhost를 사용합니다.');
  process.env.SERVER_IP = 'localhost';
}

// 데이터베이스 연결 테스트 후 서버 시작
async function startServer() {
  try {
    console.log(`[웹 서버] 데이터베이스 연결 테스트 시작... (${new Date().toLocaleString('ko-KR')})`);

    const isDbConnected = await testConnection();
    if (!isDbConnected) {
      console.error('[웹 서버] ❌ 데이터베이스 연결에 실패했습니다. 서버를 시작할 수 없습니다.');
      console.error('[웹 서버] 환경변수 확인:');
      console.error(`[웹 서버] - DATABASE_URL: ${process.env.DATABASE_URL ? '설정됨' : '없음'}`);
      console.error(`[웹 서버] - DB_USER: ${process.env.DB_USER ? '설정됨' : '없음'}`);
      console.error(`[웹 서버] - DB_PW: ${process.env.DB_PW ? '설정됨' : '없음'}`);
      process.exit(1);
    }

    console.log('[웹 서버] ✅ 모든 데이터베이스 연결이 성공했습니다.');

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

    return server;

  } catch (error) {
    console.error(`[웹 서버] 서버 시작 중 오류: ${error.message}`);
    process.exit(1);
  }
}

// 서버 시작
startServer().then(server => {
  // SIGINT(Ctrl+C) 처리
  process.on('SIGINT', () => {
    console.log('[웹 서버] SIGINT 신호를 받았습니다. 서버를 종료합니다...');

    // 데이터베이스 연결 종료 시도
    try {
      const { sequelize, rankSequelize, kadanSequelize } = require('./db/session');
      console.log('[웹 서버] 데이터베이스 연결 종료 중...');

      Promise.all([
        sequelize.close(),
        rankSequelize.close(),
        kadanSequelize.close()
      ])
      .then(() => {
        console.log('[웹 서버] 모든 데이터베이스 연결이 종료되었습니다.');
      })
      .catch(err => {
        console.error('[웹 서버] 데이터베이스 연결 종료 오류:', err);
      })
      .finally(() => {
        // 서버 종료
        server.close(() => {
          console.log('[웹 서버] HTTP 서버가 정상적으로 종료되었습니다.');

          // Discord 클라이언트 종료
          if (global.discordClient) {
            console.log('[웹 서버] Discord 클라이언트 연결 종료 중...');
            global.discordClient.destroy()
              .then(() => console.log('[웹 서버] Discord 클라이언트가 정상적으로 종료되었습니다.'))
              .catch(err => console.error('[웹 서버] Discord 클라이언트 종료 오류:', err))
              .finally(() => {
                console.log('[웹 서버] 프로세스를 종료합니다.');
                setTimeout(() => process.exit(0), 1000); // 1초 후 강제 종료
              });
          } else {
            console.log('[웹 서버] 프로세스를 종료합니다.');
            setTimeout(() => process.exit(0), 1000); // 1초 후 강제 종료
          }
        });
      });
    } catch (error) {
      console.error('[웹 서버] 종료 중 오류 발생:', error);
      process.exit(1);
    }
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
