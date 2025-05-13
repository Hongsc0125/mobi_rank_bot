// 환경 변수 로드
require('dotenv').config();

// Discord.js 관련 모듈 임포트
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 클라이언트 인스턴스 생성
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// 명령어 컬렉션 설정
client.commands = new Collection();

// 준비 이벤트 핸들러
client.on(Events.ClientReady, () => {
  console.log(`${client.user.tag} 봇이 준비되었습니다! (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);
  console.log(`서버 수: ${client.guilds.cache.size}`);
  
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

// 봇 로그인 시도 기록
console.log(`봇 로그인 시도 중... (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);

// 봇 로그인
client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log(`봇 로그인 성공! (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);
  })
  .catch(error => {
    console.error(`봇 로그인 오류: ${error.message}`);
    console.log(`환경변수 확인: DISCORD_TOKEN ${process.env.DISCORD_TOKEN ? '존재함' : '없음'}`);
  });

// 에러 핸들링
process.on('unhandledRejection', error => {
  console.error('처리되지 않은 프로미스 거부:', error);
});