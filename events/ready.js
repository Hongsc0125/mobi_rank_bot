const { Events } = require('discord.js');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`${client.user.tag} 봇이 준비되었습니다! (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);
  },
};
