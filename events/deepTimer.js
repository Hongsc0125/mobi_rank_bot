const { Events } = require('discord.js');
const { DateTime } = require('luxon');
const { kadanSequelize } = require('../db/session');
const fs = require('fs');

// 심층 제보 업데이트 타이머 변수
let deepReportUpdateTimer = null;

/**
 * 모든 심층 채널 목록 조회
 * @returns {Promise<Array>} 심층 채널 목록 (deep_ch_id, guild_id)
 */
async function getAllDeepChannels() {
    try {
        const query = `
            SELECT deep_ch_id, guild_id, deep_guild_auth
            FROM deep_pair
        `;
        
        const results = await kadanSequelize.query(query, {
            type: kadanSequelize.QueryTypes.SELECT
        });
        
        return results;
    } catch (error) {
        console.error('심층 채널 목록 조회 오류:', error);
        return [];
    }
}

/**
 * 심층 제보 채널에 안내 메시지 관리
 * @param {Discord.TextChannel} channel 디스코드 채널
 * @param {string} guideContent 안내 메시지 내용
 */
async function manageGuideMessage(channel, guideContent) {
    try {
        // 채널에서 최근 100개 메시지 가져오기
        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (!messages) return null;

        // 봇이 보낸 안내 메시지 확인 (제목에 '심층 제보 등록 방법' 포함)
        const botGuideMessage = messages.find(msg => 
            msg.author.id === channel.client.user.id && 
            msg.content.includes('심층 제보 등록 방법')
        );

        // 안내 메시지가 있는 경우 업데이트, 없으면 새로 생성
        if (botGuideMessage) {
            // 기존 메시지가 최신 메시지가 아니면 삭제하고 새로 생성
            const latestMessage = messages.first();
            if (botGuideMessage.id !== latestMessage.id) {
                await botGuideMessage.delete().catch(() => {});
                const newGuideMessage = await channel.send(guideContent);
                console.log(`채널 ${channel.name}의 안내 메시지 재생성`); 
                return newGuideMessage;
            }
            
            // 기존 메시지가 최신 메시지이고 내용이 같으면 유지
            if (botGuideMessage.content === guideContent) {
                console.log(`채널 ${channel.name}의 안내 메시지 변경 없음`);
                return botGuideMessage;
            }
            
            // 기존 메시지 내용이 다르면 업데이트
            await botGuideMessage.edit(guideContent).catch(() => {});
            console.log(`채널 ${channel.name}의 안내 메시지 업데이트`);
            return botGuideMessage;
        } else {
            // 새 메시지 생성
            const newGuideMessage = await channel.send(guideContent);
            console.log(`채널 ${channel.name}에 새 안내 메시지 생성`);
            return newGuideMessage;
        }
    } catch (error) {
        console.error(`안내 메시지 관리 오류 (${channel.name}):`, error.message);
        return null;
    }
}

/**
 * 안내 메시지 관리 (제보메시지 관리 기능 제외)
 * @param {Discord.Client} client 디스코드 클라이언트
 */
async function updateDeepReports(client) {
    try {
        // 모든 심층 채널 조회
        const deepChannels = await getAllDeepChannels();
        console.log(`심층 채널 업데이트 검색: ${deepChannels.length}개 채널 조회됨`);
        
        // 현재 시간 기준 (한국 시간)
        const now = DateTime.now().setZone('Asia/Seoul');
        
        // 안내 메시지 내용 (현재 시간 포함)
        const currentTime = now.toFormat('a h:mm').replace('AM', '오전').replace('PM', '오후');
        const guideMessage = `# 심층 제보 등록 방법
> 1. 심층 이미지를 채팅창에 업로드하세요
> 2. 잠시 기다리면 나타나는 등록양식에 맵 위치 및 잔여 시간을 입력하세요
> 3. 심층이 사라지거나 오류가 발견되면 신고 버튼을 눌러주세요

업데이트: **${currentTime}**`;
        
        // 각 채널별 처리
        for (const channel of deepChannels) {
            // 채널 정보 가져오기 시도
            try {
                const discordChannel = await client.channels.fetch(channel.deep_ch_id).catch(() => null);
                if (!discordChannel) {
                    console.log(`채널 접근 불가: ${channel.deep_ch_id}`);
                    continue;
                }
                
                // 채널에 봇이 쓰기 권한이 있는지 확인
                if (!discordChannel.permissionsFor(client.user).has(['SendMessages', 'ViewChannel'])) {
                    console.log(`채널 권한 부족: ${discordChannel.name}`);
                    continue;
                }
                
                console.log(`채널 업데이트 시도: ${discordChannel.name}`);
                
                // 안내 메시지 관리
                try {
                    const updatedGuideMessage = await manageGuideMessage(discordChannel, guideMessage);
                    if (updatedGuideMessage) {
                        console.log(`${discordChannel.name} 채널의 안내 메시지 관리 완료`);
                    }
                } catch (guideError) {
                    console.error(`안내 메시지 관리 실패 (${discordChannel.name}):`, guideError.message);
                }
                
            } catch (err) {
                console.error(`채널 처리 중 오류 (${channel.deep_ch_id}):`, err.message);
            }
        }
    } catch (error) {
        console.error('안내 메시지 관리 오류:', error);
    }
}

/**
 * 심층 제보 업데이트 타이머 설정 함수
 * @param {Discord.Client} client 디스코드 클라이언트
 */
function setupDeepReportUpdateTimer(client) {
    // 이미 타이머가 설정되어 있는 경우 기존 타이머 정리
    if (deepReportUpdateTimer) {
        clearInterval(deepReportUpdateTimer);
        console.log('기존 심층 제보 업데이트 타이머 정리');
    }
    
    // 2분(120초) 마다 심층 제보 업데이트 함수 실행
    const UPDATE_INTERVAL = 2 * 60 * 1000; // 2분을 밀리초로 변환
    
    // 먼저 한 번 즉시 실행
    (async () => {
        try {
            console.log('초기 심층 제보 업데이트 실행 (즉시)');
            await updateDeepReports(client);
        } catch (error) {
            console.error('초기 심층 제보 업데이트 오류:', error);
        }
    })();
    
    // 그 후 정해진 간격으로 실행
    deepReportUpdateTimer = setInterval(async () => {
        try {
            console.log(`심층 제보 업데이트 타이머 실행: ${new Date().toLocaleTimeString('ko-KR')}`);
            await updateDeepReports(client);
        } catch (error) {
            console.error('심층 제보 타이머 오류:', error);
        }
    }, UPDATE_INTERVAL);
    
    console.log(`심층 제보 업데이트 타이머 설정 완료: 간격 ${UPDATE_INTERVAL/1000}초`);
}

module.exports = {
    name: Events.ClientReady,
    once: false,
    async execute(client) {
        // 심층 제보 업데이트 타이머 설정 (봇 시작 시 한 번만 실행)
        if (!client.deepUpdateTimerSetup) {
            client.deepUpdateTimerSetup = true;
            setupDeepReportUpdateTimer(client);
            console.log('심층 제보 업데이트 타이머 시작');
        }
    }
};
