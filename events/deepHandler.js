const fs = require('fs');
const path = require('path');
const https = require('https');
const { kadanSequelize } = require('../db/session');
const { DateTime } = require('luxon');
const { 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    TextInputBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputStyle, 
    EmbedBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    StringSelectMenuOptionBuilder,
    ContainerBuilder,
    MediaGalleryBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
    AttachmentBuilder
} = require('discord.js');

// 이미지 저장 디렉토리 설정
const DEEP_IMAGES_DIR = path.join(__dirname, '../images/deep');
// 디렉토리가 없으면 생성
if (!fs.existsSync(DEEP_IMAGES_DIR)) {
    fs.mkdirSync(DEEP_IMAGES_DIR, { recursive: true });
}

/**
 * 심층 제보 알림 받을 사용자 목록 조회
 * @param {string} deep_ch_id 심층 채널 ID
 * @returns {Promise<Array>} 알림 받을 사용자 목록
 */
async function getDeepAlertUsers(deep_ch_id) {
    try {
        const query = `
            SELECT user_id, guild_id
            FROM deep_alert_user
            WHERE deep_ch_id = :deep_ch_id
        `;
        
        const results = await kadanSequelize.query(query, {
            replacements: { deep_ch_id },
            type: kadanSequelize.QueryTypes.SELECT
        });
        
        // 개발 환경에서는 봇 운영자에게만 알림 전송
        if (process.env.NODE_ENV === "development") {
            const BOT_OPERATOR_ID = "307620267067179019";
            return results.filter(user => user.user_id === BOT_OPERATOR_ID);
        }
        
        return results;
    } catch (error) {
        console.error('심층 알림 대상자 조회 오류:', error);
        return [];
    }
}

// 심층 제보 처리를 위한 데이터 저장
const deepSubmissions = new Map();

/**
 * 채널이 심층 채널인지 확인
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

/**
 * 이미지 URL에서 로컬 파일로 다운로드
 * @param {string} url 이미지 URL
 * @param {string} localPath 로컬 경로
 * @returns {Promise<void>}
 */
async function downloadImage(url, localPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(localPath);
        https.get(url, response => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', err => {
            fs.unlink(localPath, () => {});
            reject(err);
        });
    });
}

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
 * 특정 채널의 활성화된 심층 제보 목록 조회
 * @param {string} channelId 채널 ID
 * @param {number} currentTimestamp 현재 시간 (Unix 타임스태프)
 * @returns {Promise<Array>} 심층 제보 목록
 */
async function getActiveDeepReports(channelId, currentTimestamp) {
    try {
        // 만료 시간을 계산하기 위한 쿼리
        const query = `
            SELECT 
                deep_id, 
                user_id, 
                user_name, 
                deep_type, 
                deep_image, 
                remaining_minutes, 
                is_error,
                create_dt,
                CAST(EXTRACT(EPOCH FROM create_dt) AS INTEGER) + (remaining_minutes * 60) AS expiry_timestamp
            FROM informant_deep_user
            WHERE deep_ch_id = :channelId
            ORDER BY create_dt DESC
        `;
        
        const results = await kadanSequelize.query(query, {
            replacements: { channelId },
            type: kadanSequelize.QueryTypes.SELECT
        });
        
        // 각 레코드에 만료 여부 추가
        const processedResults = results.map(report => {
            return {
                ...report,
                is_expired: currentTimestamp > report.expiry_timestamp,
                status: report.is_error === 'Y' ? '오제보' : 
                        (currentTimestamp > report.expiry_timestamp ? '만료됨' : '활성')
            };
        });
        
        return processedResults;
    } catch (error) {
        console.error(`채널 ${channelId}의 심층 제보 조회 오류:`, error);
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
 * 심층 제보 버튼 상태 업데이트
 * @param {Discord.TextChannel} channel 디스코드 채널
 * @param {Array} reports 활성 심층 제보 목록
 */
async function updateReportButtons(channel, reports) {
    try {
        // 채널에서 최근 100개 메시지 가져오기
        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (!messages) return;

        // 신고 버튼이 있는 메시지 필터링
        const reportMessages = messages.filter(msg => {
            // 메시지에 버튼이 있는지 확인
            if (!msg.components || msg.components.length === 0) return false;
            
            // 신고 버튼이 있는지 확인
            const hasReportButton = msg.components.some(row => 
                row.components && row.components.some(comp => 
                    comp.customId && comp.customId.startsWith('deep_report_')
                )
            );
            
            return hasReportButton;
        });

        console.log(`채널 ${channel.name}에서 신고 버튼 있는 메시지 ${reportMessages.size}개 발견`);
        
        // 각 메시지 처리
        for (const [id, message] of reportMessages) {
            // 버튼에서 deep_id 추출
            let deepId = null;
            messageLoop: for (const row of message.components) {
                for (const component of row.components) {
                    if (component.customId && component.customId.startsWith('deep_report_')) {
                        deepId = component.customId.split('_').pop();
                        break messageLoop;
                    }
                }
            }
            
            if (!deepId) continue;
            
            // 해당 심층 제보 찾기
            const matchedReport = reports.find(report => report.deep_id === deepId);
            if (!matchedReport) continue;
            
            // 버튼 상태 업데이트가 필요한지 확인
            let needsUpdate = false;
            
            // 오제보나 만료된 심층이면 버튼 업데이트 필요
            if (matchedReport.is_error === 'Y' || matchedReport.is_expired) {
                needsUpdate = true;
            }
            
            // 업데이트가 필요하지 않으면 건너뛰
            if (!needsUpdate) continue;
            
            // 버튼 상태 업데이트 시도
            try {
                // 새로운 컴포넌트로 메시지 업데이트
                const updatedComponents = [];
                
                // 기존 컴포넌트 복사하되 해당 버튼만 변경
                for (const row of message.components) {
                    const newRow = new ActionRowBuilder();
                    const components = [];
                    
                    for (const component of row.components) {
                        if (component.customId && component.customId.startsWith('deep_report_') && component.customId.endsWith(deepId)) {
                            // 오제보이거나 만료된 경우 버튼 상태 변경
                            const newButton = ButtonBuilder.from(component)
                                .setDisabled(true);
                            
                            // 버튼 라벨 변경
                            if (matchedReport.is_error === 'Y') {
                                newButton.setLabel('오제보');
                                newButton.setStyle(ButtonStyle.Danger);
                            } else if (matchedReport.is_expired) {
                                newButton.setLabel('만료됨');
                                newButton.setStyle(ButtonStyle.Secondary);
                            }
                            
                            components.push(newButton);
                        } else {
                            components.push(ButtonBuilder.from(component));
                        }
                    }
                    
                    newRow.addComponents(components);
                    updatedComponents.push(newRow);
                }
                
                // 변경된 컴포넌트로 메시지 업데이트
                await message.edit({ components: updatedComponents });
                console.log(`심층 제보 ${deepId} 버튼 상태 업데이트 성공: ${matchedReport.status}`);
            } catch (updateError) {
                console.error(`버튼 상태 업데이트 실패 (${deepId}):`, updateError.message);
            }
        }
    } catch (error) {
        console.error(`버튼 업데이트 오류 (${channel.name}):`, error.message);
    }
}


/**
 * 상호작용 핸들러 설정 함수
 */
function setupInteractionHandlers(client) {
    // 이미 핸들러가 등록되어 있는지 확인
    if (client.deepHandlersSetup) return;
    
    // 등록 표시
    client.deepHandlersSetup = true;
    console.log('심층 제보 상호작용 핸들러 등록 완료');
    
    // 버튼 및 선택 메뉴 인터랙션 핸들러
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
        
        const customId = interaction.customId;
        console.log(`인터랙션 받음: ${customId}`);
        
        if (!customId.startsWith('map_select_') && 
            !customId.startsWith('deep_info_') && 
            !customId.startsWith('deep_submit_') && 
            !customId.startsWith('deep_cancel_') &&
            !customId.startsWith('deep_report_')) return;
        
        // 심층 제보 신고 버튼이 클릭되었을 경우
        if (customId.startsWith('deep_report_')) {
            const deepId = customId.split('_').pop();
            
            // 신고 모달 생성
            const modal = new ModalBuilder()
                .setCustomId(`deep_report_modal_${deepId}`)
                .setTitle('심층 제보 신고');
            
            const reasonInput = new TextInputBuilder()
                .setCustomId('reportReason')
                .setLabel('⚠️ 주의: 허위 신고시 사용이 제한됩니다.')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('확실히 확인하고 신고하세요! 허위 신고시 신고기능 영구 사용 불가가 될 수 있습니다! 신고 사유를 입력해주세요.')
                .setRequired(true);
            
            const reasonRow = new ActionRowBuilder().addComponents(reasonInput);
            
            modal.addComponents(reasonRow);
            
            await interaction.showModal(modal);
            return;
        }
        
        const messageId = customId.split('_').pop();
        const formData = deepSubmissions.get(messageId);
        
        if (!formData) return;
        
        try {
            // 맵 선택 시
            if (customId.startsWith('map_select_')) {
                const selectedMap = interaction.values[0];
                
                // 현재 시간(Unix 타임스탬프, 초 단위)
                const currentTimestamp = Math.floor(Date.now() / 1000);
                
                // 현재 채널에서 활성화된 심층 제보 확인
                const activeReports = await getActiveDeepReports(interaction.channelId, currentTimestamp);
                
                // 선택한 맵에 이미 활성화된 제보가 있는지 확인
                const hasDuplicate = activeReports.some(report => 
                    report.deep_type === selectedMap && !report.is_expired && report.is_error !== 'Y'
                );
                
                if (hasDuplicate) {
                    // 중복 제보가 있는 경우 경고 메시지 표시
                    await interaction.update({
                        content: `이미 ${selectedMap}에 활성화된 심층 제보가 있습니다. 다른 맵을 선택하거나, 시간이 지난 후 다시 시도해주세요.`,
                        components: []
                    });
                    
                    // 3초 후 메시지 삭제
                    setTimeout(async () => {
                        try {
                            // 원본 이미지와 안내 메시지 삭제
                            await formData.originalMessage.delete().catch(e => console.log('원본 메시지 삭제 실패:', e.message));
                            await formData.replyMessage.delete().catch(e => console.log('안내 메시지 삭제 실패:', e.message));
                            
                            // 폼 데이터 제거
                            deepSubmissions.delete(messageId);
                        } catch (error) {
                            console.error('메시지 정리 중 오류:', error);
                        }
                    }, 3000);
                    
                    return;
                }
                
                // 중복이 없는 경우 맵 선택 처리
                formData.deep_type = selectedMap;
                // 피드백 없이 무응답
                await interaction.deferUpdate();
            }
            // 추가 정보 버튼 클릭 시
            else if (customId.startsWith('deep_info_')) {
                try {
                    const modal = new ModalBuilder()
                        .setCustomId(`deep_modal_${messageId}`)
                        .setTitle('심층 추가 정보');
                    
                    const timeInput = new TextInputBuilder()
                        .setCustomId('remainingMinutes')
                        .setLabel('몇 분 남았나요?')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('심층이 사라지기까지 남은 분 수를 입력해주세요')
                        .setRequired(true);
                    
                    const commentInput = new TextInputBuilder()
                        .setCustomId('comment')
                        .setLabel('코멘트')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMaxLength(40)
                        .setPlaceholder('추가 정보를 입력해주세요 (예: 2개 있음, 3개 있음 등)')
                        .setRequired(false);
                    
                    const firstRow = new ActionRowBuilder().addComponents(timeInput);
                    const secondRow = new ActionRowBuilder().addComponents(commentInput);
                    
                    modal.addComponents(firstRow, secondRow);
                    
                    await interaction.showModal(modal);
                } catch (error) {
                    console.error('모달 표시 중 오류:', error);
                }
            }
            // 등록 완료 버튼 클릭 시
            else if (customId.startsWith('deep_submit_')) {
                // 버튼 클릭 즉시 응답 (상호작용 오류 방지)
                await interaction.deferUpdate().catch(() => {});
                
                // 입력 정보 유효성 검사
                if (!formData.deep_type) {
                    await interaction.followUp({ 
                        content: '맵을 선택해주세요.', 
                        ephemeral: true 
                    }).catch(() => {});
                    return;
                }
                
                if (!formData.remaining_minutes) {
                    await interaction.followUp({ 
                        content: '남은 시간을 입력해주세요.', 
                        ephemeral: true 
                    }).catch(() => {});
                    return;
                }
                
                // 등록 완료 시점에 다시 한번 중복 제보 확인
                const currentTimestamp = Math.floor(Date.now() / 1000);
                const activeReports = await getActiveDeepReports(interaction.channelId, currentTimestamp);
                
                // 선택한 맵에 이미 활성화된 제보가 있는지 확인
                const hasDuplicate = activeReports.some(report => 
                    report.deep_type === formData.deep_type && !report.is_expired && report.is_error !== 'Y'
                );
                
                if (hasDuplicate) {
                    // 중복 제보가 있는 경우 경고 메시지 표시
                    await interaction.followUp({ 
                        content: `이미 ${formData.deep_type}에 활성화된 심층 제보가 있습니다. 현재 제보가 취소되었습니다.`, 
                        ephemeral: true 
                    }).catch(() => {});
                    
                    // 원본 이미지와 등록 폼 즉시 삭제
                    await formData.replyMessage.delete().catch(e => console.log('등록 폼 삭제 실패:', e.message));
                    await formData.originalMessage.delete().catch(e => console.log('원본 메시지 삭제 실패:', e.message));
                    
                    // 폼 데이터 제거
                    deepSubmissions.delete(messageId);
                    return;
                }
                
                // 원본 이미지와 등록 폼 즉시 삭제 (처리 전 먼저 삭제)
                await formData.replyMessage.delete().catch(e => console.log('등록 폼 삭제 실패:', e.message));
                await formData.originalMessage.delete().catch(e => console.log('원본 메시지 삭제 실패:', e.message));
                
                try {
                    // 이미지 다운로드
                    const localImagePath = path.join(DEEP_IMAGES_DIR, formData.deep_image);
                    
                    await downloadImage(formData.image_url, localImagePath);
                    console.log(`이미지 저장 완료: ${localImagePath}`);
                    
                    // 데이터베이스에 저장
                    // DB에 저장하고 반환된 deep_id 가져오기
                    const result = await kadanSequelize.query(`
                        INSERT INTO informant_deep_user (
                            user_id, 
                            user_name, 
                            guild_id, 
                            guild_name, 
                            deep_ch_id, 
                            deep_image,
                            deep_type,
                            remaining_minutes
                        ) VALUES (
                            CAST(:user_id AS VARCHAR), 
                            CAST(:user_name AS VARCHAR), 
                            CAST(:guild_id AS VARCHAR), 
                            CAST(:guild_name AS VARCHAR), 
                            CAST(:deep_ch_id AS VARCHAR), 
                            CAST(:deep_image AS VARCHAR),
                            CAST(:deep_type AS VARCHAR),
                            :remaining_minutes
                        )
                        RETURNING deep_id
                    `, {
                        replacements: {
                            user_id: formData.user_id,
                            user_name: formData.user_name,
                            guild_id: formData.guild_id,
                            guild_name: formData.guild_name,
                            deep_ch_id: formData.deep_ch_id,
                            deep_image: formData.deep_image,
                            deep_type: formData.deep_type,
                            remaining_minutes: formData.remaining_minutes
                        },
                        type: kadanSequelize.QueryTypes.INSERT
                    });
                    
                    // Sequelize 쿼리 결과에서 deep_id 추출 (결과 구조 세부적으로 처리)
                    let deepId = '알 수 없음';
                    try {
                        if (Array.isArray(result) && result.length > 0) {
                            if (Array.isArray(result[0]) && result[0].length > 0 && result[0][0].deep_id) {
                                deepId = result[0][0].deep_id;
                            } else if (result[0].deep_id) {
                                deepId = result[0].deep_id;
                            } else if (result[0][0] && typeof result[0][0] === 'object') {
                                // 객체의 첫 번째 키 값을 가져옴
                                const firstKey = Object.keys(result[0][0])[0];
                                deepId = result[0][0][firstKey];
                            }
                        }
                    } catch (e) {
                        console.log('deep_id 추출 오류:', e.message);
                        console.log('쿼리 결과 구조:', JSON.stringify(result));
                    }
                    
                    console.log(`DB 저장 성공: ${formData.deep_image} - 사용자 ${formData.user_name}(${formData.user_id}) - deep_id: ${deepId}`);
                    
                    // 완료 메시지 전송 후 5초 후 삭제
                    const completeMessage = await interaction.channel.send({
                        content: `<@${formData.user_id}> 심층 제보가 완료되었습니다. (신고번호: ${deepId})`
                    }).catch(e => {
                        console.log('완료 메시지 전송 실패:', e.message);
                        return null;
                    });
                    
                    if (completeMessage) {
                        setTimeout(() => {
                            completeMessage.delete().catch(() => {});
                        }, 5000);
                    }
                    
                    // 심층 제보 알림 보내기
                    try {
                        // 웹 서버를 통해 접근할 수 있는 이미지 URL 생성
                        const webImageUrl = `http://${process.env.SERVER_IP}:${process.env.WEB_PORT}/images/deep/${formData.deep_image}`;

                        console.log(`심층 제보 알림 URL: ${webImageUrl}`)
                        
                        // 알림 받을 사용자 목록 조회
                        const alertUsers = await getDeepAlertUsers(formData.deep_ch_id);
                        console.log(`심층 알림 대상자 ${alertUsers.length}명 검색됨`);
                        
                        // 심층 제보 메시지 컨텐츠 생성
                        const mapName = formData.deep_type || '알 수 없음';
                        const remainingMinutes = formData.remaining_minutes || '?';
                        const comment = formData.comment || '';
                        const user = await client.users.fetch(formData.user_id);

                        // 맵 이름에 이모지 추가
                        let displayMapName = mapName;
                        if (mapName === '여신의뜰') {
                            displayMapName = '🌍 여신의뜰';
                        } else if (mapName === '얼음협곡') {
                            displayMapName = '❄️ 얼음협곡';
                        }
                        
                        // luxon으로 한국 시간 기반 시간처리
                        const now = DateTime.now().setZone('Asia/Seoul');
                        const unixTimeNow = Math.floor(now.toSeconds());
                        
                        // 종료 예정 시간 계산 (분 추가)
                        const end = now.plus({ minutes: parseInt(remainingMinutes) });
                        const unixTimeEnd = Math.floor(end.toSeconds());
                        
                        // 한국식 시간 형식 (오전/오후 표시)
                        const startTimeStr = now.toFormat('a h:mm').replace('AM', '오전').replace('PM', '오후');
                        const endTimeStr = end.toFormat('a h:mm').replace('AM', '오전').replace('PM', '오후');
                        const commentText = comment ? `### ${comment}` : '';

                        const section = new SectionBuilder()
                            .setThumbnailAccessory(
                              new ThumbnailBuilder().setURL(webImageUrl)
                            )
                            .addTextDisplayComponents(
                                new TextDisplayBuilder()
                                    .setContent(
                                        `## ${displayMapName}\n`+
                                        `### 제보시간\n> \`${startTimeStr}\`\n`+
                                        `### 종료예정\n> \`${endTimeStr}\`\n`+
                                        `### 제보자\n> <@${user.id}>`
                                    )
                            )

                        // 컨테이너 시작
                        const dmContainer = new ContainerBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`# <:__:1371228573146419372> 심층 제보 알림`)
                            )
                            .addSeparatorComponents(
                                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                            )
                            .addSectionComponents(section)
                            .addSeparatorComponents(
                                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                            )

                            if (comment) {
                                dmContainer
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(commentText)
                                )
                                .addSeparatorComponents(
                                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                                )
                            }

                            dmContainer
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(`- 종료시간이 1~2분정도의 오차가 있을 수 있습니다.\n- 제보번호 : ${deepId}`)
                                )
                        
                        // 신고 버튼 추가
                        dmContainer.addActionRowComponents(
                            new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(`deep_report_${deepId}`)
                                        .setLabel('잘못된 제보 신고')
                                        .setStyle(ButtonStyle.Danger)
                                        .setEmoji('⚠️')
                                )
                        );
                        
                        // 3. 심층 채널에 보고서 메시지 등록 
                        const channel = await client.channels.fetch(formData.deep_ch_id).catch(() => null);
                        if (channel) {
                            await channel.send({
                                components: [dmContainer],
                                flags: MessageFlags.IsComponentsV2
                            }).catch(e => {
                                console.error('채널에 심층 보고서 등록 실패:', e.message);
                            });
                        }
                        
                        // 4. 각 사용자에게 DM 알림 전송
                        if (alertUsers.length > 0) {
                            for (const user of alertUsers) {
                                try {
                                    const targetUser = await client.users.fetch(user.user_id);
                                    if (targetUser) {
                                        await targetUser.send({
                                            components: [dmContainer],
                                            flags: MessageFlags.IsComponentsV2
                                        }).catch(e => {
                                            console.log(`사용자 ${user.user_id}에게 알림 전송 실패:`, e.message);
                                        });
                                        console.log(`사용자 ${targetUser.tag}(${user.user_id})에게 심층 알림 전송 완료`);
                                    }
                                } catch (userError) {
                                    console.log(`사용자 ${user.user_id} 처리 오류:`, userError.message);
                                }
                            }
                        }
                    } catch (alertError) {
                        console.error('심층 알림 전송 중 오류:', alertError);
                    }
                    
                    // 폼 데이터 제거
                    deepSubmissions.delete(messageId);
                } catch (error) {
                    console.error('심층 제보 등록 중 오류:', error);
                    await interaction.update({
                        content: `<@${formData.user_id}> 심층 제보 등록 중 오류가 발생했습니다. 다시 시도해주세요.`,
                        embeds: [],
                        components: []
                    });
                }
            }
            // 취소 버튼 클릭 시
            else if (customId.startsWith('deep_cancel_')) {
                // 버튼 클릭 즉시 응답 (상호작용 오류 방지)
                await interaction.deferUpdate().catch(() => {});
                
                // 원본 이미지와 등록 폼 즉시 삭제
                await formData.replyMessage.delete().catch(e => console.log('등록 폼 삭제 실패:', e.message));
                await formData.originalMessage.delete().catch(e => console.log('원본 메시지 삭제 실패:', e.message));
                
                // 취소 메시지 전송 후 5초 후 자동 삭제
                const cancelMessage = await interaction.channel.send({
                    content: `<@${formData.user_id}> 심층 제보가 취소되었습니다.`
                }).catch(e => {
                    console.log('취소 메시지 전송 실패:', e.message);
                    return null;
                });
                
                if (cancelMessage) {
                    setTimeout(() => {
                        cancelMessage.delete().catch(() => {});
                    }, 3000);
                }
                
                // 폼 데이터 제거
                deepSubmissions.delete(messageId);
            }
        } catch (error) {
            console.error('인터랙션 처리 중 오류:', error);
        }
    });
    
    // 모달 제출 인터랙션 핸들러
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isModalSubmit()) return;
        
        const customId = interaction.customId;
        
        // 심층 신고 모달 처리
        if (customId.startsWith('deep_report_modal_')) {
            try {
                // 신고된 심층 제보 ID 추출
                const deepId = customId.split('_').pop();
                
                // 신고 사유 가져오기
                const reason = interaction.fields.getTextInputValue('reportReason');
                
                // 신고자 정보
                const reportUserId = interaction.user.id;
                const reportUserName = interaction.user.username;
                
                // 1. error_deep_info 테이블에 신고 정보 저장
                await kadanSequelize.query(`
                    INSERT INTO error_deep_info (
                        deep_id,
                        report_user_id,
                        report_user_name,
                        reason
                    ) VALUES (
                        :deep_id,
                        :report_user_id,
                        :report_user_name,
                        :reason
                    )
                `, {
                    replacements: {
                        deep_id: deepId,
                        report_user_id: reportUserId,
                        report_user_name: reportUserName,
                        reason: reason
                    },
                    type: kadanSequelize.QueryTypes.INSERT
                });
                
                // 2. informant_deep_user 테이블의 is_error 값을 'Y'로 업데이트
                await kadanSequelize.query(`
                    UPDATE informant_deep_user
                    SET is_error = 'Y'
                    WHERE deep_id = :deep_id
                `, {
                    replacements: { deep_id: deepId },
                    type: kadanSequelize.QueryTypes.UPDATE
                });
                
                // 신고 성공 응답
                await interaction.reply({ 
                    content: `심층 제보 신고가 접수되었습니다. 관리자가 확인 후 조치하게 됩니다. 신고번호: ${deepId}`,
                    ephemeral: true
                });
                
                console.log(`심층 제보 신고 접수: ${deepId}, 신고자: ${reportUserName}(${reportUserId})`);
                
            } catch (error) {
                console.error('심층 제보 신고 처리 중 오류:', error);
                
                await interaction.reply({
                    content: '신고 처리 중 오류가 발생했습니다. 다시 시도해주세요.',
                    ephemeral: true
                }).catch(() => {});
            }
            return;
        }
        
        // 일반 심층 정보 입력 모달 처리
        if (!customId.startsWith('deep_modal_')) return;
        
        const messageId = customId.split('_').pop();
        const formData = deepSubmissions.get(messageId);
        
        if (!formData) return;
        
        try {
            // 모달에서 값 가져오기
            const remainingMinutes = interaction.fields.getTextInputValue('remainingMinutes');
            const comment = interaction.fields.getTextInputValue('comment');
            
            // 폼 데이터 업데이트
            // 숫자로 변환하여 저장 (bigint 타입)
            formData.remaining_minutes = parseInt(remainingMinutes, 10);
            
            // 코멘트가 있으면 저장 (데이터베이스에는 저장하지 않음)
            if (comment) {
                formData.comment = comment;
            }
            
            // 사용자에게 응답
            const commentText = comment ? `추가 정보: ${comment}` : '';
            
            // 모달 제출 후 "등록 완료" 버튼을 눌러달라는 안내 메시지 표시
            await interaction.reply({ 
                content: `시간(${remainingMinutes}분) 코멘트(${commentText})정보가 입력되었습니다.\n**"등록 완료" 버튼을 눌러 제보를 완료해주세요.**`, 
                ephemeral: true 
            });
        } catch (error) {
            console.error('모달 제출 처리 중 오류:', error);
        }
    });
}

// 타이머 관련 함수는 deepTimer.js로 이동했습니다

module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        // 봇 메시지 무시
        if (message.author.bot) return;
        
        try {
            // 메시지가 서버에서 온 것인지 확인
            if (!message.guild) return;
            
            // 심층 제보 채널인지 확인
            const channelInfo = await isDeepChannel(message.channel.id);
            if (!channelInfo) return;
            
            // 이미지 첨부 여부 확인
            if (message.attachments.size === 0) {
                // 이미지가 없는 메시지는 삭제
                await message.delete().catch(console.error);
                const reply = await message.channel.send({
                    content: `<@${message.author.id}> 심층 제보를 위해서는 이미지를 첨부해주세요.`
                });
                // 3초 후 안내 메시지도 삭제
                setTimeout(() => reply.delete().catch(console.error), 3000);
                return;
            }
            
            // 첨부파일 중 첫 번째 이미지 파일 가져오기
            const attachment = message.attachments.first();
            
            // 이미지 파일인지 확인
            const isImage = attachment.contentType && attachment.contentType.startsWith('image/');
            if (!isImage) {
                await message.delete().catch(console.error);
                const reply = await message.channel.send({
                    content: `<@${message.author.id}> 심층 제보를 위해서는 이미지 파일만 첨부해주세요.`
                });
                setTimeout(() => reply.delete().catch(console.error), 3000);
                return;
            }
            
            // 현재 시간(Unix 타임스탬프, 초 단위)
            const currentTimestamp = Math.floor(Date.now() / 1000);
            
            // 현재 채널에서 활성화된 심층 제보 확인
            const activeReports = await getActiveDeepReports(message.channel.id, currentTimestamp);
            
            // 활성화된 심층 제보 중에서 여신의뜰과 얼음협곡 각각 중복 여부 확인
            const activeGarden = activeReports.find(report => 
                report.deep_type === '여신의뜰' && !report.is_expired && report.is_error !== 'Y'
            );
            
            const activeIce = activeReports.find(report => 
                report.deep_type === '얼음협곡' && !report.is_expired && report.is_error !== 'Y'
            );
            
            // 중복 제보 확인 메시지 준비
            let duplicateMessage = '';
            if (activeGarden && activeIce) {
                duplicateMessage = '현재 여신의뜰과 얼음협곡 모두 활성화된 심층 제보가 있습니다. 시간이 지난 후 다시 시도해주세요.';
            } else if (activeGarden) {
                duplicateMessage = '현재 여신의뜰에 활성화된 심층 제보가 있습니다. 다른 지역을 선택하거나, 시간이 지난 후 다시 시도해주세요.';
            } else if (activeIce) {
                duplicateMessage = '현재 얼음협곡에 활성화된 심층 제보가 있습니다. 다른 지역을 선택하거나, 시간이 지난 후 다시 시도해주세요.';
            }
            
            // 중복된 제보가 있으면 메시지 삭제 및 안내
            if (duplicateMessage) {
                await message.delete().catch(console.error);
                const reply = await message.channel.send({
                    content: `<@${message.author.id}> ${duplicateMessage}`
                });
                setTimeout(() => reply.delete().catch(console.error), 5000);
                return;
            }

            // 이미지 파일 정보 준비
            const fileExtension = path.extname(attachment.name) || '.png';
            const timestamp = Date.now();
            const imageFileName = `deep_${message.author.id}_${timestamp}${fileExtension}`;
            
            // 심층 제보 입력 폼
            const headerText = `## 심층 제보\n> 심층 제보에 대한 자세한 정보를 입력해주세요.`;
            const footerText = `## ⚠️ 주의사항\n`+
                                `> • 이미 등록된 위치는 시간이 지날 때까지 중복 제보가 불가능합니다\n`+
                                `> • 신고가 들어오면 제보 정보가 자동 삭제됩니다\n`+
                                `> • 허위 제보 시 서버 이용에 제한을 받을 수 있습니다\n`+
                                `> • 잘못 작성 하셨거나, 제보가 이상하면 \`@힝트시\` 를 호출해주세요.`;


            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(headerText)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true)
                )
                .addActionRowComponents(
                    new ActionRowBuilder()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId(`map_select_${message.id}`)
                                .setPlaceholder('심층 위치를 선택해주세요')
                                .addOptions([
                                    new StringSelectMenuOptionBuilder()
                                        .setLabel('여신의뜰')
                                        .setValue('여신의뜰')
                                        .setDescription('여신의뜰에 심층이 떳어요!')
                                        .setEmoji({
                                            name: '🌍',
                                        }),
                                    new StringSelectMenuOptionBuilder()
                                        .setLabel('얼음협곡')
                                        .setValue('얼음협곡')
                                        .setDescription('얼음협곡에 심층이 떳어요!')
                                        .setEmoji({
                                            name: '❄️',
                                        }),
                                ]),
                        ),
                )
                .addActionRowComponents(
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`deep_info_${message.id}`)
                                .setLabel('잔여시간 & 추가설명 입력')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`deep_submit_${message.id}`)
                                .setLabel('등록 완료')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`deep_cancel_${message.id}`)
                                .setLabel('취소')
                                .setStyle(ButtonStyle.Danger),
                        ),
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(footerText)
                );
            
            // 사용자에게 알림 메시지 전송 (원본 이미지 메시지에 대한 답변)
            const sentMessage = await message.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });
            
            // 심층 제보 데이터 객체 생성
            const deepData = {
                user_id: message.author.id,
                user_name: message.author.username,
                guild_id: message.guild.id,
                guild_name: message.guild.name,
                deep_ch_id: message.channel.id,
                deep_image: imageFileName,
                image_url: attachment.url,
                deep_type: null,
                remaining_minutes: null,
                comment: null,
                originalMessage: message,
                replyMessage: sentMessage,
                timestamp: Date.now()
            };
            
            // 메시지 ID를 키로 사용하여 데이터MAP 저장
            deepSubmissions.set(message.id, deepData);
            
            console.log(`심층 제보 입력 폼 설정 완료: ${message.author.username}(${message.author.id})`);
            
            // 상호작용 핸들러를 설정
            setupInteractionHandlers(message.client);
        } catch (error) {
            console.error('심층 이미지 처리 중 오류:', error);
        }
    }
};