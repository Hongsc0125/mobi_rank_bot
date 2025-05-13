const { SlashCommandBuilder, EmbedBuilder, Colors, MessageFlags } = require('discord.js');
const { logger } = require('../../db/session');
const { ALERT_TYPE_NAMES } = require('./alert');
const settings = require('../../core/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('알림테스트')
        .setDescription('관리자용: 알림 테스트 메시지를 전송합니다')
        .addStringOption(option =>
            option.setName('유형')
                .setDescription('테스트할 알림 유형')
                .setRequired(true)
                .addChoices(
                    { name: '결계', value: 'REALM' },
                    { name: '보스', value: 'BOSS' },
                    { name: '커스텀', value: 'CUSTOM' }
                ))
        .addBooleanOption(option =>
            option.setName('사전알림')
                .setDescription('5분 전 사전 알림인지 여부')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('대상')
                .setDescription('테스트 알림을 받을 사용자')
                .setRequired(true)),
    
    // 관리자 권한 체크 - 오직 지정된 ID만 사용 가능
    async isAdmin(userId) {
        // 테스트 알림 명령어는 오직 이 ID만 사용 가능
        const ADMIN_ID = '307620267067179019'; 
        return userId === ADMIN_ID;
    },
    
    async execute(interaction) {
        try {
            // 관리자 권한 확인
            if (!await this.isAdmin(interaction.user.id)) {
                await interaction.reply({ 
                    content: '⚠️ 이 명령어는 관리자만 사용할 수 있습니다.', 
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }
            
            // 옵션 파싱
            const alertType = interaction.options.getString('유형');
            const isWarning = interaction.options.getBoolean('사전알림');
            const targetUser = interaction.options.getUser('대상');
            
            // 메시지 전송 중임을 알림
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            // 알림 관리자의 테스트 알림 함수 호출
            const result = await interaction.client.alertManager.testAlert(
                alertType,
                isWarning,
                targetUser.id
            );
            
            // 결과 응답
            if (result) {
                await interaction.editReply({ 
                    content: `✅ ${targetUser.username}님에게 ${ALERT_TYPE_NAMES[alertType] || alertType} ${isWarning ? '(5분 전)' : '(정시)'} 테스트 알림을 전송했습니다.`,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.editReply({ 
                    content: `❌ ${targetUser.username}님에게 테스트 알림 전송에 실패했습니다. 로그를 확인해주세요.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            
        } catch (error) {
            logger.error(`테스트 알림 명령어 실행 중 오류: ${error.message}`);
            
            // 이미 응답했는지 확인
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ 
                    content: `❌ 알림 테스트 중 오류가 발생했습니다: ${error.message}`,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.reply({ 
                    content: `❌ 알림 테스트 중 오류가 발생했습니다: ${error.message}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    }
};
