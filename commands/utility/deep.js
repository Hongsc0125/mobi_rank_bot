const { kadanSequelize } = require('../../db/session');
const fs = require('fs');
const path = require('path');

// 이미지 저장 디렉토리 설정
const DEEP_IMAGES_DIR = path.join(__dirname, '../../images/deep');
// 디렉토리가 없으면 생성
if (!fs.existsSync(DEEP_IMAGES_DIR)) {
    fs.mkdirSync(DEEP_IMAGES_DIR, { recursive: true });
}

/**
 * deep_pair 테이블에서 심층 채널 목록 가져오기
 */
async function getDeepChannels() {
    try {
        const [results] = await kadanSequelize.query(
            'SELECT deep_ch_id, deep_guild_auth, guild_id FROM deep_pair'
        );
        return results;
    } catch (err) {
        console.error('심층 채널 조회 오류:', err);
        throw err;
    }
}

/**
 * 특정 채널이 심층 채널인지 확인
 */
async function isDeepChannel(channelId) {
    try {
        const [results] = await kadanSequelize.query(
            'SELECT deep_guild_auth, guild_id FROM deep_pair WHERE deep_ch_id = ?',
            { replacements: [channelId] }
        );
        return results.length > 0 ? results[0] : null;
    } catch (err) {
        console.error('심층 채널 확인 오류:', err);
        throw err;
    }
}

// 유틸리티 함수만 내보내기
module.exports = {
    getDeepChannels,
    isDeepChannel,
    DEEP_IMAGES_DIR
};
