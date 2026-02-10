-- 랭크 요청 관리 테이블 생성
CREATE TABLE IF NOT EXISTS rank_requests (
    id SERIAL PRIMARY KEY,
    search_key VARCHAR(255) NOT NULL,         -- 서버-캐릭터 키 (검색 단위)
    user_key VARCHAR(255) NOT NULL,           -- 사용자-서버-캐릭터 키 (사용자별 고유키)
    user_id VARCHAR(255) NOT NULL,            -- Discord 사용자 ID
    channel_id VARCHAR(255) NOT NULL,         -- Discord 채널 ID
    guild_id VARCHAR(255),                    -- Discord 길드 ID (선택사항)
    server_name VARCHAR(50) NOT NULL,         -- 마비노기 서버명
    character_name VARCHAR(100) NOT NULL,     -- 캐릭터명
    loading_message_id VARCHAR(255),          -- 로딩 메시지 ID
    status VARCHAR(20) DEFAULT 'waiting',     -- 상태: waiting, processing, completed, failed
    job_id VARCHAR(255),                      -- API 작업 ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 인덱스 설정
    INDEX idx_search_key (search_key),
    INDEX idx_user_key (user_key),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    
    -- 제약조건
    CONSTRAINT unique_user_request UNIQUE (user_key),
    CONSTRAINT check_status CHECK (status IN ('waiting', 'processing', 'completed', 'failed'))
);

-- 업데이트 트리거 (updated_at 자동 갱신)
CREATE OR REPLACE FUNCTION update_rank_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_rank_requests_updated_at
    BEFORE UPDATE ON rank_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_rank_requests_updated_at();

-- 오래된 요청 정리용 인덱스 (1시간 이상 된 요청은 정리)
CREATE INDEX IF NOT EXISTS idx_rank_requests_cleanup 
ON rank_requests (created_at) 
WHERE status IN ('waiting', 'processing');