// 환경 변수 로드
require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
// 명령어 폴더에서 모든 명령어 파일 가져오기
const commandsPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(commandsPath);

for (const folder of commandFolders) {
  const folderPath = path.join(commandsPath, folder);
  if (fs.statSync(folderPath).isDirectory()) {
    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
      const filePath = path.join(folderPath, file);
      const command = require(filePath);
      if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
      } else {
        console.log(`[경고] ${filePath} 파일에 필요한 "data"나 "execute" 속성이 없습니다.`);
      }
    }
  }
}

// REST 인스턴스 생성
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// 명령어 배포 함수
(async () => {
  try {
    console.log(`${commands.length}개의 슬래시 명령어를 등록하는 중...`);

    // 명령어 등록 - 개발 서버 전용 (더 빠른 업데이트)
    if (process.env.GUILD_ID) {
      const data = await rest.put(
        Routes.applicationGuildCommands(process.env.APPLICATION_ID, process.env.GUILD_ID),
        { body: commands },
      );
      console.log(`${data.length}개의 명령어가 서버에 등록되었습니다!`);
    } 
    // 글로벌 명령어 등록 (모든 서버, 업데이트에 1시간 소요)
    else {
      const data = await rest.put(
        Routes.applicationCommands(process.env.APPLICATION_ID),
        { body: commands },
      );
      console.log(`${data.length}개의 명령어가 글로벌로 등록되었습니다!`);
    }
  } catch (error) {
    console.error('명령어 등록 중 오류 발생:', error);
  }
})();
