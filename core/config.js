// 환경 변수 설정 관리

require('dotenv').config();

const settings = {
    // 데이터베이스 설정
    DATABASE_NAME: process.env.DATABASE_NAME || 'rank_data',
    DATABASE_URL: `postgresql://${process.env.DB_USER}:${process.env.DB_PW}@${process.env.DATABASE_URL}/${process.env.DATABASE_NAME}`,
    RANK_DATA_URL: `postgresql://${process.env.DB_USER}:${process.env.DB_PW}@${process.env.DATABASE_URL}/${process.env.DATABASE_NAME}`,
    
    // Discord 봇 설정
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    APPLICATION_ID: process.env.APPLICATION_ID,
    PUBLIC_KEY: process.env.PUBLIC_KEY,
    
    // API 설정
    RANK_API_URL: process.env.RANK_API_URL,
    
    // 시간대 설정
    TIMEZONE: 'Asia/Seoul'
};

module.exports = settings;
