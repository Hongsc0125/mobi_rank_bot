const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('봇의 응답 속도를 확인합니다.'),
  async execute(interaction) {
    const sent = await interaction.reply({ content: '핑 측정 중...', fetchReply: true });
    const pingTime = `${sent.createdTimestamp - interaction.createdTimestamp}ms`;
    const apiPing = `${Math.round(interaction.client.ws.ping)}ms`;
    
    await interaction.editReply(`🏓 퐁! 
    봇 지연시간: ${pingTime}
    API 지연시간: ${apiPing}
    현재 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  },
};
