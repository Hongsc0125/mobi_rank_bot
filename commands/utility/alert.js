const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const { Sequelize, Op } = require('sequelize');
const { kadanSequelize, logger } = require('../../db/session');
const settings = require('../../core/config');

// 요일 정의
const DAY_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// 알림 타입 이름 및 이모지
const ALERT_TYPE_NAMES = {
    'monday': '월요일',
    'tuesday': '화요일',
    'wednesday': '수요일',
    'thursday': '목요일',
    'friday': '금요일',
    'saturday': '토요일',
    'sunday': '일요일',
    'day': '매일',
    'custom_monday': '커스텀 월요일',
    'custom_tuesday': '커스텀 화요일',
    'custom_wednesday': '커스텀 수요일',
    'custom_thursday': '커스텀 목요일',
    'custom_friday': '커스텀 금요일',
    'custom_saturday': '커스텀 토요일',
    'custom_sunday': '커스텀 일요일'
};

const ALERT_TYPE_EMOJI = {
    'monday': '🔵',
    'tuesday': '🟠',
    'wednesday': '🟢',
    'thursday': '🟣',
    'friday': '🟡',
    'saturday': '🔴',
    'sunday': '⚪',
    'day': '📅',
    'custom_monday': '💠',
    'custom_tuesday': '💠',
    'custom_wednesday': '💠',
    'custom_thursday': '💠',
    'custom_friday': '💠',
    'custom_saturday': '💠',
    'custom_sunday': '💠'
};

// 알림 조회 쿼리 함수
async function getUpcomingAlerts(alertTime, dayOfWeek) {
    try {
        const query = `
            SELECT a.alert_id, a.alert_type, a.alert_time, a.interval, au.user_id
            FROM alert a
            JOIN alert_user au ON a.alert_id = au.alert_id
            WHERE 
                CASE 
                    WHEN a.interval = 'day' THEN true
                    WHEN a.interval = 'week' AND a.alert_type = :day_of_week THEN true
                    WHEN a.interval = 'week' AND a.alert_type = 'custom_' || :day_of_week THEN true
                    ELSE false
                END
            AND a.alert_time = :alert_time
        `;
        
        const results = await kadanSequelize.query(query, {
            replacements: {
                alert_time: alertTime,
                day_of_week: dayOfWeek
            },
            type: Sequelize.QueryTypes.SELECT,
            raw: true
        });
        
        return results || [];
    } catch (error) {
        logger.error(`알림 조회 중 오류: ${error.message}`);
        return [];
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('알림')
        .setDescription('알림 관련 정보를 표시합니다.'),
    
    async execute(interaction) {
        // MessageFlags 가져오기
        const { MessageFlags } = require('discord.js');
        
        await interaction.reply({ 
            content: '현재 당신이 등록한 알림이 자동으로 처리되고 있습니다. 특별한 문제가 있다면 관리자에게 문의해주세요.',
            flags: MessageFlags.Ephemeral
        });
    },
    
    // 알림 관련 기능을 여기에 추가
    getUpcomingAlerts,
    DAY_OF_WEEK,
    ALERT_TYPE_NAMES,
    ALERT_TYPE_EMOJI
};
