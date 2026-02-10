// Discord 클라이언트 인스턴스 (공유용)
// 이 파일은 봇을 시작하지 않고, 클라이언트 인스턴스만 export 합니다.
require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');

// 클라이언트 인스턴스 생성
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 명령어 컬렉션 설정
client.commands = new Collection();

module.exports = { client };
