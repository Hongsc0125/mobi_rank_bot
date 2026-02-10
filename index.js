// 환경 변수 로드
require('dotenv').config();

// Discord.js 관련 모듈 임포트
const { Events } = require('discord.js');
const { client } = require('./client'); // 공유 클라이언트 인스턴스 import
const { sendDiscordMessage, sendSimpleEmbedMessage } = require('./utils/post_patch_note');
const fs = require('fs');
const path = require('path');

// 데이터베이스 연결 테스트 모듈
const { testConnection } = require('./db/session');

// DB 초기화
const { initializeRankRequests } = require('./db/init_rank_requests');

// 준비 이벤트 핸들러
client.on(Events.ClientReady, async () => {
  console.log(`${client.user.tag} 봇이 준비되었습니다! (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);
  console.log(`서버 수: ${client.guilds.cache.size}`);
  
  // DB 초기화
  await initializeRankRequests();
  
  // 정기적으로 오래된 요청 정리 (30초마다)
  const RankRequest = require('./db/models/RankRequest');
  setInterval(async () => {
    try {
      const cleanedCount = await RankRequest.cleanupOldRequests();
      if (cleanedCount > 0) {
        console.log(`🧹 ${cleanedCount}개의 오래된 랭크 요청이 정리되었습니다.`);
      }
    } catch (error) {
      console.error('랭크 요청 정리 중 오류:', error);
    }
  }, 30 * 1000); // 30초
  
  // 등록된 명령어 목록 출력
  console.log('\n=== 등록된 명령어 목록 ===');
  let commandList = [];
  client.commands.forEach((command) => {
    commandList.push(`/${command.data.name}`);
  });
  commandList.sort(); // 알파벳 순 정렬
  console.log(commandList.join(', '));
  console.log('======================\n');
});

// 이벤트 핸들러 로드
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
  
  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }
}

// 명령어 로드
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFolders = fs.readdirSync(commandsPath);
  
  for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    if (fs.statSync(folderPath).isDirectory()) {
      const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
      for (const file of commandFiles) {
        const filePath = path.join(folderPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
        }
      }
    }
  }
}

// 명령어 핸들링
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`${interaction.commandName} 명령어를 찾을 수 없습니다.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '명령어 실행 중 오류가 발생했습니다!', ephemeral: true });
    } else {
      await interaction.reply({ content: '명령어 실행 중 오류가 발생했습니다!', ephemeral: true });
    }
  }
});

// 데이터베이스 연결 테스트 후 봇 시작
async function startBot() {
  try {
    console.log(`데이터베이스 연결 테스트 시작... (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);

    const isDbConnected = await testConnection();
    if (!isDbConnected) {
      console.error('❌ 데이터베이스 연결에 실패했습니다. 봇을 시작할 수 없습니다.');
      console.error('환경변수 확인:');
      console.error(`- DATABASE_URL: ${process.env.DATABASE_URL ? '설정됨' : '없음'}`);
      console.error(`- DB_USER: ${process.env.DB_USER ? '설정됨' : '없음'}`);
      console.error(`- DB_PW: ${process.env.DB_PW ? '설정됨' : '없음'}`);
      process.exit(1);
    }

    console.log('✅ 모든 데이터베이스 연결이 성공했습니다.');
    console.log(`봇 로그인 시도 중... (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);

    // 봇 로그인
    await client.login(process.env.DISCORD_TOKEN);
    console.log(`봇 로그인 성공! (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);

  } catch (error) {
    console.error(`봇 시작 중 오류: ${error.message}`);
    console.error(`환경변수 확인: DISCORD_TOKEN ${process.env.DISCORD_TOKEN ? '존재함' : '없음'}`);
    process.exit(1);
  }
}

// 봇 시작
startBot();

// 에러 핸들링
process.on('unhandledRejection', error => {
  console.error('처리되지 않은 프로미스 거부:', error);
});


async function sendToChannel() {
  return await sendDiscordMessage(client);
}

// 테스트용 임베드 전송 함수 추가
async function sendToChannelTest() {
  return await sendSimpleEmbedMessage(client);
}

module.exports = {
  client,
  sendToChannel,
  sendToChannelTest // 테스트 함수 내보내기
};