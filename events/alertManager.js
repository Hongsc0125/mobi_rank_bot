// 알림 관리자 이벤트 모듈
const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    AttachmentBuilder,
    MessageFlags,
    ThumbnailBuilder,
    SectionBuilder,
    ContainerBuilder,
    MediaGalleryBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize
  } = require('discord.js');
const { Events } = require('discord.js');
const { logger } = require('../db/session');
const { getUpcomingAlerts, DAY_OF_WEEK, ALERT_TYPE_NAMES, ALERT_TYPE_EMOJI } = require('../commands/utility/alert');
const settings = require('../core/config');
const { DateTime } = require('luxon');

module.exports = {
    name: Events.ClientReady,
    once: false,
    
    /**
     * 알림 관리자 기능 실행
     * @param {Discord.Client} client 디스코드 클라이언트 인스턴스
     */
    async execute(client) {
        // 첫 실행 시에만 초기화 (여러 번 실행되지 않도록)
        if (!client.alertManager) {
            logger.info('알림 관리자 초기화 중...');
            
            // 알림 관리자 객체 생성
            client.alertManager = {
                lastSentAlerts: new Map(),
                checkInterval: null,
                
                /**
                 * 관리자용 테스트 알림 전송 함수
                 * @param {string} alertType 알림 유형 ('REALM', 'BOSS', 'CUSTOM' 중 하나)
                 * @param {boolean} isWarning 5분 전 경고 알림 여부
                 * @param {string} userId 알림을 받을 사용자 ID
                 */
                async testAlert(alertType, isWarning, userId) {
                    try {
                        // 사용자 정보 가져오기
                        const user = await client.users.fetch(userId);
                        if (!user || user.bot) {
                            logger.error(`테스트 알림: 사용자 ${userId} 가 유효하지 않습니다.`);
                            return;
                        }
                        
                        const unixTime = Math.floor(Date.now() / 1000);
                        const typeName = ALERT_TYPE_NAMES[alertType] || alertType;
                        
                        // 테스트용 시간 생성
                        const now = DateTime.now().setZone(settings.TIMEZONE);
                        const testTime = isWarning ? 
                            now.plus({ minutes: 5 }).toFormat('HH:mm') : 
                            now.toFormat('HH:mm');
                              
                        
                        const section = new SectionBuilder()
                            .setThumbnailAccessory(
                              new ThumbnailBuilder().setURL('https://harmari.duckdns.org/static/alarm.png')
                            )
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`## <:__:1371228573146419372> ${typeName} 알림  \`${testTime}\``)
                            )
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(isWarning 
                                    ? `\n알림 : 5분 후 **${typeName}**가 시작 될 예정입니다!` 
                                    : `\n알림 : **${typeName}**가 지금 시작되었습니다!`)
                            )


                        // 컴포넌트 생성
                        const components = 
                            new ContainerBuilder()
                                .addSectionComponents(section)
                                .addSeparatorComponents(
                                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                                )
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(`*<t:${unixTime}:F>* (테스트 알림)`)
                                )
                
                        
                        // 알림 전송
                        try {
                            await user.send({
                                components: [components], 
                                flags: MessageFlags.IsComponentsV2
                            });
                            logger.info(`테스트 알림 전송 완료 (${typeName}, ${isWarning ? '5분전' : '정시'}) : ${user.username} (${userId})`);
                            return true;
                        } catch (e) {
                            if (e.code === 50007) {
                                logger.warn(`사용자 ${user.username} (${userId})에게 DM을 보낼 수 없습니다.`);
                            } else {
                                logger.error(`테스트 알림 전송 중 오류: ${e.message}`);
                            }
                            return false;
                        }
                    } catch (e) {
                        logger.error(`테스트 알림 생성 중 오류: ${e.message}`);
                        return false;
                    }
                },
                
                /**
                 * 알림이 이미 발송되었는지 확인
                 * @param {Object} alert 알림 객체
                 * @param {string} userId 사용자 ID
                 * @returns {boolean} 알림 발송 여부
                 */
                wasAlertSent(alert, userId) {
                    const alertId = alert.alert_id;
                    const alertKey = `${alertId}-${userId}`;
                    const today = DateTime.now().setZone(settings.TIMEZONE).toISODate();
                    return this.lastSentAlerts.has(alertKey) && this.lastSentAlerts.get(alertKey) === today;
                },
                
                /**
                 * 사용자에게 알림 전송
                 * @param {string} alertTime 알림 시간
                 * @param {string} dayOfWeek 요일명
                 * @param {boolean} isWarning 5분 전 경고 알림 여부
                 */
                async sendAlerts(alertTime, dayOfWeek, isWarning = false) {
                    try {
                        // 데이터베이스에서 현재 시간에 대한 알림 가져오기
                        const alerts = await getUpcomingAlerts(alertTime, dayOfWeek);
                        
                        if (!alerts || alerts.length === 0) {
                            return;
                        }
                        
                        const unixTime = Math.floor(Date.now() / 1000);

                        // 사용자별로 알림 그룹화
                        let userAlerts = {};
                        for (const alert of alerts) {
                            const userId = alert.user_id;
                            if (!userAlerts[userId]) {
                                userAlerts[userId] = [];
                            }
                            userAlerts[userId].push(alert);
                        }
                        
                        // 개발 환경에서는 알림을 봇 운영자에게만 전송
                        if (process.env.NODE_ENV === "development") {
                            const BOT_OPERATOR_ID = "307620267067179019";
                            
                            // 운영자 ID가 있는 경우에만 유지, 다른 사용자는 필터링
                            const filteredAlerts = {};
                            if (userAlerts[BOT_OPERATOR_ID]) {
                                filteredAlerts[BOT_OPERATOR_ID] = userAlerts[BOT_OPERATOR_ID];
                            }
                            
                            userAlerts = filteredAlerts;
                            logger.info(`개발 환경: 봇 운영자만 알림 받음 (${Object.keys(userAlerts).length} 명)`);
                        }
                        
                        // 사용자에게 DM 전송
                        for (const [userId, userAlertList] of Object.entries(userAlerts)) {
                            try {
                                const user = await client.users.fetch(userId);
                                if (!user || user.bot) {
                                    continue;
                                }

                                // 유형별로 알림 그룹화
                                const alertTypes = {};
                                for (const alert of userAlertList) {
                                    const alertType = alert.alert_type;
                                    if (!alertTypes[alertType]) {
                                        alertTypes[alertType] = [];
                                    }
                                    alertTypes[alertType].push(alert);
                                }
                                
                                // 알림 메시지 컴포넌트 준비
                                const components = [];
                                let hasAlerts = false;
                                
                                // 알림 유형별로 컴포넌트 추가
                                for (const [alertType, alertsOfType] of Object.entries(alertTypes)) {
                                    // 이미 처리된 알림 건너뛰기
                                    if (isWarning && this.wasAlertSent(alertsOfType[0], userId)) {
                                        continue;
                                    }
                                    
                                    // 시간 포맷팅 - 한국 시간 사용
                                    const times = alertsOfType.map(alert => {
                                        const timeParts = alert.alert_time.split(':');
                                        return `${timeParts[0]}:${timeParts[1]}`;
                                    }).join(', ');
                                    
                                    const typeName = ALERT_TYPE_NAMES[alertType] || alertType;
                                    
                                    // 섹션 영역 생성
                                    const section = new SectionBuilder()
                                        .setThumbnailAccessory(
                                          new ThumbnailBuilder().setURL('https://harmari.duckdns.org/static/alarm.png')
                                        )
                                        .addTextDisplayComponents(
                                            new TextDisplayBuilder().setContent(`## <:__:1371228573146419372> ${typeName} 알림  \`${times}\``)
                                        )
                                        .addTextDisplayComponents(
                                            new TextDisplayBuilder().setContent(isWarning 
                                                ? `\n알림 : 5분 후 **${typeName}**가 시작 될 예정입니다!` 
                                                : `\n알림 : **${typeName}**가 지금 시작되었습니다!`)
                                        );

                                    // 컴포넌트 추가
                                    components.push(
                                        new ContainerBuilder()
                                            .addSectionComponents(section)
                                            .addSeparatorComponents(
                                                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                                            )
                                            .addTextDisplayComponents(
                                                new TextDisplayBuilder().setContent(`*<t:${unixTime}:F>*`)
                                            )
                                    );
                                    
                                    hasAlerts = true;
                                    
                                    // 알림 발송 기록
                                    if (!isWarning) {
                                        for (const alert of alertsOfType) {
                                            const alertKey = `${alert.alert_id}-${userId}`;
                                            const today = DateTime.now().setZone(settings.TIMEZONE).toISODate();
                                            this.lastSentAlerts.set(alertKey, today);
                                        }
                                    }
                                }
                                
                                // 알림이 있는 경우에만 전송
                                if (hasAlerts) {
                                    try {
                                        await user.send({ components });
                                        logger.info(`알림 전송 완료: ${user.username} (${userId})`);
                                    } catch (e) {
                                        if (e.code === 50007) {
                                            logger.warn(`사용자 ${user.username} (${userId})에게 DM을 보낼 수 없습니다.`);
                                        } else {
                                            logger.error(`알림 전송 중 오류: ${e.message}`);
                                        }
                                    }
                                }
                            } catch (e) {
                                logger.error(`사용자 ${userId}에게 알림 전송 중 오류: ${e.message}`);
                            }
                        }
                    } catch (e) {
                        logger.error(`알림 전송 중 오류: ${e.message}`);
                    }
                },
                
                /**
                 * 정기적으로 알림을 확인하는 함수
                 */
                async checkAlerts() {
                    try {
                        // 현재 한국 시간 가져오기
                        const now = DateTime.now().setZone(settings.TIMEZONE);
                        const currentTime = now.toFormat('HH:mm:00');
                        
                        // 5분 후 경고 알림 시간 계산
                        const warningTime = now.plus({ minutes: 5 }).toFormat('HH:mm:00');
                        
                        // 현재 요일 확인 (1: 월요일, 7: 일요일을 0: 월요일, 6: 일요일로 변환)
                        const weekdayIndex = now.weekday - 1;
                        const dayOfWeek = DAY_OF_WEEK[weekdayIndex];
                        
                        // 정각 알림 확인
                        const exactTimeKey = `${currentTime}-exact`;
                        const today = now.toISODate();
                        
                        if (!this.lastSentAlerts.has(exactTimeKey) || this.lastSentAlerts.get(exactTimeKey) !== today) {
                            await this.sendAlerts(currentTime, dayOfWeek, false);
                            this.lastSentAlerts.set(exactTimeKey, today);
                        }
                        
                        // 5분 전 경고 알림 확인
                        const warningKey = `${warningTime}-warning`;
                        if (!this.lastSentAlerts.has(warningKey) || this.lastSentAlerts.get(warningKey) !== today) {
                            await this.sendAlerts(warningTime, dayOfWeek, true);
                            this.lastSentAlerts.set(warningKey, today);
                        }
                    } catch (e) {
                        logger.error(`알림 체크 중 오류: ${e.message}`);
                    }
                },
                
                /**
                 * 알림 시작 함수
                 */
                start() {
                    if (this.checkInterval) {
                        clearInterval(this.checkInterval);
                    }
                    
                    // 정각에 정확하게 알림을 보내기 위해 다음 분의 시작(00초)까지 대기 후 시작
                    const now = DateTime.now().setZone(settings.TIMEZONE);
                    const seconds = now.second;
                    const milliseconds = now.millisecond;
                    
                    // 다음 분의 시작까지 기다릴 시간(밀리초)
                    const delay = ((60 - seconds) * 1000) - milliseconds;
                    
                    logger.info(`알림 관리자 초기화 중... ${Math.floor(delay/1000)}.${Math.floor(delay%1000)}초 후 첫 분 시작에 맞춰 실행됩니다.`);
                    
                    // 처음에는 분의 정확한 시작 시점에 맞춰 실행
                    setTimeout(() => {
                        logger.info(`알림 관리자가 시작되었습니다. (${DateTime.now().setZone(settings.TIMEZONE).toFormat('HH:mm:ss.SSS')})`);
                        
                        // 첫 부분 실행
                        this.checkAlerts();
                        
                        // 이후 정확히 1분마다 실행 (매 분 00초에 실행)
                        this.checkInterval = setInterval(() => {
                            logger.info(`정각 알림 확인 시작 (${DateTime.now().setZone(settings.TIMEZONE).toFormat('HH:mm:ss.SSS')})`);
                            this.checkAlerts();
                        }, 60 * 1000);
                    }, delay);
                },
                
                /**
                 * 알림 정지 함수
                 */
                stop() {
                    if (this.checkInterval) {
                        clearInterval(this.checkInterval);
                        this.checkInterval = null;
                        logger.info('알림 관리자가 중지되었습니다.');
                    }
                }
            };
            
            // 알림 관리자 시작
            client.alertManager.start();
        }
    }
};
