const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const { Sequelize, Op } = require('sequelize');
const { kadanSequelize, logger } = require('../../db/session');
const settings = require('../../core/config');

// 요일 정의 - 데이터베이스에 저장된 형태로 변경
const DAY_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// 알림 타입 이름 및 이모지 (데이터베이스에 저장된 실제 형식 기준)
const ALERT_TYPE_NAMES = {
    'boss': '보스',
    'barrier': '결계',
    'mon': '월요일',
    'tue': '화요일',
    'wed': '수요일',
    'thu': '목요일',
    'fri': '금요일',
    'sat': '토요일',
    'sun': '일요일',
    'day': '매일',
    'custom': '커스텀',
    'custom_mon': '커스텀 월요일',
    'custom_tue': '커스텀 화요일',
    'custom_wed': '커스텀 수요일',
    'custom_thu': '커스텀 목요일',
    'custom_fri': '커스텀 금요일',
    'custom_sat': '커스텀 토요일',
    'custom_sun': '커스텀 일요일'
};

const ALERT_TYPE_EMOJI = {
    'boss': '💀',       // 울린 우주인
    'barrier': '🔰',    // 결계
    'mon': '🔵',       // 월요일 - 파란색
    'tue': '🟠',       // 화요일 - 주황색
    'wed': '🟢',       // 수요일 - 초록색
    'thu': '🟣',       // 목요일 - 보라색
    'fri': '🟡',       // 금요일 - 노란색
    'sat': '🔴',       // 토요일 - 빨간색
    'sun': '⚪',         // 일요일 - 흰색
    'day': '📅',       // 매일
    'custom': '💠',     // 커스텀 일반
    'custom_mon': '💠',  // 커스텀 월요일
    'custom_tue': '💠',  // 커스텀 화요일
    'custom_wed': '💠',  // 커스텀 수요일
    'custom_thu': '💠',  // 커스텀 목요일
    'custom_fri': '💠',  // 커스텀 금요일
    'custom_sat': '💠',  // 커스텀 토요일
    'custom_sun': '💠'   // 커스텀 일요일
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
    // 알림 관련 함수 및 상수 내보내기
    getUpcomingAlerts,
    DAY_OF_WEEK,
    ALERT_TYPE_NAMES,
    ALERT_TYPE_EMOJI
};
