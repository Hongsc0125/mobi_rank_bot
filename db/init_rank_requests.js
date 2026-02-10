const { sequelize } = require('./session');
const RankRequest = require('./models/RankRequest');

async function initializeRankRequests() {
  try {
    // 테이블 생성 (존재하지 않으면)
    await RankRequest.sync({ force: false });
    console.log('✅ rank_requests 테이블이 성공적으로 생성되었습니다.');
    
    // 기존 미완료 요청들 정리
    const cleanedCount = await RankRequest.cleanupOldRequests();
    if (cleanedCount > 0) {
      console.log(`🧹 ${cleanedCount}개의 오래된 요청이 정리되었습니다.`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ rank_requests 테이블 초기화 실패:', error);
    return false;
  }
}

// 직접 실행 시
if (require.main === module) {
  initializeRankRequests().then(() => {
    process.exit(0);
  });
}

module.exports = { initializeRankRequests };