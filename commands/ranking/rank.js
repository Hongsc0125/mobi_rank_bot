const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MessageFlags,
  ContainerBuilder,
  MediaGalleryBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize
} = require('discord.js');
const axios = require('axios');
const { rankSequelize, logger } = require('../../db/session');
const settings = require('../../core/config');
const { Sequelize } = require('sequelize');
const RankRequest = require('../../db/models/RankRequest');

// DB 기반 요청 관리 (기존 Map 제거)

module.exports = {
  data: new SlashCommandBuilder()
    .setName('랭크')
    .setDescription('캐릭터의 랭킹 정보를 조회합니다'),

  async execute(interaction) {
    try {
      // 1) 모달 띄우기
      const modal = new ModalBuilder()
        .setCustomId('rank-modal')
        .setTitle('캐릭터 랭킹 조회')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('server')
              .setLabel('서버 이름')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('character')
              .setLabel('캐릭터 이름')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

      await interaction.showModal(modal);

      // 2) 모달 제출 응답 대기
      const modalSubmit = await interaction.awaitModalSubmit({
        filter: (i) => i.customId === 'rank-modal',
        time: 60000
      });

      const server = modalSubmit.fields.getTextInputValue('server');
      const character = modalSubmit.fields.getTextInputValue('character');

      // 서버명 유효성 검증
      const validServers = ['데이안', '아이라', '던컨', '알리사', '메이븐', '라사', '칼릭스'];
      if (!validServers.includes(server)) {
        await modalSubmit.reply({ 
          content: '⚠️ 올바른 서버명을 입력해주세요. (데이안, 아이라, 던컨, 알리사, 메이븐, 라사, 칼릭스)', 
          ephemeral: true 
        });
        return;
      }

      // 사용자별 중복 요청 체크 (DB 기반)
      const userKey = `${interaction.user.id}-${server}-${character}`;
      const existingRequest = await RankRequest.findByUserKey(userKey);
      if (existingRequest) {
        await modalSubmit.reply({ 
          content: '⚠️ 해당 캐릭터의 조회가 이미 진행 중입니다. 잠시만 기다려주세요.', 
          ephemeral: true 
        });
        return;
      }

      await modalSubmit.deferReply({ content: '실시간 랭킹 조회중입니다... (최대 60초까지 소요될 수 있습니다)' });

      // DB 조회부터 시작
      processRankingRequest(server, character, modalSubmit, interaction);

    } catch (error) {
      logger.error(`랭크 명령 오류: ${error.message}`);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '오류가 발생했습니다.',
          ephemeral: true
        });
      }
    }
  }
};

// DB 조회 후 즉시 응답 또는 백그라운드 처리
async function processRankingRequest(server, character, modalSubmit, interaction) {
  const userKey = `${interaction.user.id}-${server}-${character}`;
  const searchKey = `${server}-${character}`;
  
  try {
    // 사용자 요청 정보를 DB에 저장 (중복 요청 방지)
    const [request, created] = await RankRequest.findOrCreate({
      where: { userKey },
      defaults: {
        searchKey: searchKey,
        userKey: userKey,
        userId: interaction.user.id,
        channelId: interaction.channel.id,
        guildId: interaction.guild?.id,
        serverName: server,
        characterName: character,
        status: 'waiting'
      }
    });
    
    if (!created) {
      logger.info(`중복 요청 감지됨: ${userKey}`);
      return; // 이미 처리 중인 요청이므로 종료
    }

    // 3) DB에서 데이터 조회 (기존 로직)
    let data = {};
    try {
      // 랭킹 타입 정의
      const rankTypes = [
        { div: 1, name: 'combat', label: '전투력' },
        { div: 2, name: 'charm', label: '매력' },
        { div: 3, name: 'life', label: '생활력' }
      ];
      
      // 각 랭킹 타입별 데이터 조회
      let hasAllRankings = true; // 전부 존재하는지 확인하는 플래그
      let rankResultCount = 0; // 가져온 결과 수 카운트
      
      for (const type of rankTypes) {
        let query;
        if (type.div === 1) {
          query = `
            SELECT character_name, server_name, class_name,
                   TO_CHAR(rank_position, 'FM999,999,999') || '위' AS rank_position,
                   TO_CHAR(power_value, 'FM999,999,999') AS power_value,
                   change_amount, change_type
            FROM mabinogi_ranking
            WHERE server_name = :server
              AND character_name = :character
              AND retrieved_at >= NOW() AT TIME ZONE 'Asia/Seoul' - INTERVAL '15 minutes'
              AND div = :div
            ORDER BY retrieved_at DESC
            LIMIT 1
          `;
        } else {
          query = `
            SELECT rank_position AS ${type.name}_rank, 
                   TO_CHAR(rank_position, 'FM999,999,999') || '위' AS ${type.name}_rank_formatted,
                   power_value AS ${type.name}_power, 
                   TO_CHAR(power_value, 'FM999,999,999') AS ${type.name}_power_formatted,
                   change_amount AS ${type.name}_change, 
                   change_type AS ${type.name}_change_type
            FROM mabinogi_ranking
            WHERE server_name = :server
              AND character_name = :character
              AND retrieved_at >= NOW() AT TIME ZONE 'Asia/Seoul' - INTERVAL '15 minutes'
              AND div = :div
            ORDER BY retrieved_at DESC
            LIMIT 1
          `;
        }
        
        const result = await rankSequelize.query(query, {
          replacements: { server, character, div: type.div },
          type: Sequelize.QueryTypes.SELECT
        });
        
        // 디버깅을 위한 로그 추가
        logger.info(`DB 조회 결과 (div=${type.div}): ${JSON.stringify(result[0])}`);
        
        if (result.length > 0) {
          rankResultCount++;
          
          if (type.div === 1) {
            // 전투력 데이터는 기본 데이터로 사용
            data = result[0];
            data.combat_rank = data.rank_position;
            data.combat_power = data.power_value;
            data.combat_change = data.change_amount;
            data.combat_change_type = data.change_type;
          } else {
            // 나머지 데이터 병합
            Object.assign(data, result[0]);
          }
        } else {
          // 하나라도 데이터가 없으면 API 호출 필요
          hasAllRankings = false;
          logger.info(`DB에서 ${type.label} 데이터가 없어 API 호출 필요`);
        }
      }
      
      // 전투력, 매력, 생활력 중 하나라도 없으면 data 객체 초기화 (아래에서 API 호출하도록)
      if (!hasAllRankings || rankResultCount === 0) {
        data = {};
      }
    } catch (e) {
      logger.error(`DB 오류: ${e.message}`);
    }

    // DB에 데이터가 있으면 즉시 응답
    if (Object.keys(data).length > 0) {
      await sendRankingResultWithOriginalUI(data, modalSubmit, interaction.user);
      // 요청 완료 처리
      await RankRequest.destroy({ where: { userKey } });
      return;
    }

    // DB에 데이터가 없으면 즉시 안내 메시지 보내고 백그라운드 처리
    const loadingMessage = await modalSubmit.followUp({
      content: `🔍 **${server} 서버의 ${character}** 최신 랭킹을 조회 중입니다.\n⏱️ 조회가 완료되면 이 채널에서 ${interaction.user}님께 결과를 전송해드리겠습니다!`
    });

    // 로딩 메시지 ID 업데이트
    await RankRequest.update(
      { loadingMessageId: loadingMessage.id },
      { where: { userKey } }
    );

    // 이미 해당 캐릭터에 대한 검색이 진행 중인지 확인
    const processingRequests = await RankRequest.findBySearchKey(searchKey);
    const isAlreadyProcessing = processingRequests.some(req => req.status === 'processing');
    
    if (isAlreadyProcessing) {
      // 이미 진행 중이면 대기 상태 유지
      logger.info(`기존 검색에 대기자 추가: ${userKey} -> ${searchKey}`);
      return;
    }

    // 새로운 검색 시작 - 첫 번째 요청을 processing 상태로 변경
    const firstRequest = processingRequests[0];
    if (firstRequest) {
      await firstRequest.update({ status: 'processing' });
    }

    // 백그라운드에서 큐 기반 API 처리 (응답 종료 후 별도 실행)
    setImmediate(() => {
      processQueueAPIInBackground(server, character, searchKey);
    });

  } catch (error) {
    logger.error('랭킹 요청 처리 중 오류:', error.message);
    // 에러 발생 시 요청 삭제
    await RankRequest.destroy({ where: { userKey } }).catch(() => {});
    if (!modalSubmit.replied) {
      await modalSubmit.followUp({
        content: '랭킹 조회 중 오류가 발생했습니다.'
      });
    }
  }
}

// 백그라운드 큐 API 처리 (모든 대기 중인 사용자에게 결과 전송)
async function processQueueAPIInBackground(server, character, searchKey) {
  try {
    // 1. 검색 요청 시작
    const searchResponse = await axios.post(`${settings.RANK_API_URL}/search`, {
      server: server,
      character: character
    }, {
      timeout: 10000
    });

    const jobId = searchResponse.data.job_id;
    logger.info(`백그라운드 랭킹 검색 작업 시작됨. Job ID: ${jobId}, 서버: ${server}, 캐릭터: ${character}`);

    // 2. 결과 대기 (폴링)
    const maxWaitTime = 15 * 60 * 1000; // 15분
    const startTime = Date.now();
    let pollInterval = 3000; // 3초로 시작

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      try {
        const statusResponse = await axios.get(`${settings.RANK_API_URL}/search/status/${jobId}`, {
          timeout: 15000
        });

        const status = statusResponse.data;
        logger.info(`백그라운드 작업 상태: ${status.status}, Job ID: ${jobId}`);

        if (status.status === 'completed') {
          // API 응답을 기존 형식으로 파싱
          const data = parseAPIResponse(status.character);
          if (data) {
            // 모든 대기 중인 사용자에게 랭킹 카드 전송
            await sendRankingToAllWaitingUsers(data, searchKey);
          } else {
            await sendErrorToAllWaitingUsers('데이터 파싱에 실패했습니다.', searchKey);
          }
          return;
        } else if (status.status === 'failed') {
          logger.error(`백그라운드 API 검색 실패: ${status.error}`);
          await sendErrorToAllWaitingUsers(status.error || '캐릭터를 찾을 수 없습니다.', searchKey);
          return;
        }

        // 시간이 지날수록 폴링 간격 늘리기
        if (Date.now() - startTime > 60000) { // 1분 후
          pollInterval = 5000; // 5초
        } else if (Date.now() - startTime > 180000) { // 3분 후
          pollInterval = 10000; // 10초
        }

      } catch (pollError) {
        logger.error('백그라운드 상태 조회 중 오류:', pollError.message);
        continue;
      }
    }

    // 타임아웃
    logger.error('백그라운드 API 조회 타임아웃');
    await sendErrorToAllWaitingUsers('조회 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.', searchKey);

  } catch (error) {
    logger.error(`백그라운드 API 오류: ${error.message}`);
    await sendErrorToAllWaitingUsers('랭킹 조회 서비스에 일시적인 문제가 발생했습니다.', searchKey);
  }
}

// API 응답을 기존 형식으로 파싱 (기존 로직)
function parseAPIResponse(apiData) {
  const rankings = apiData.rankings || {};
  
  // 랭킹 데이터 추출
  const combatData = rankings["전투력"] || {};
  const charmData = rankings["매력"] || {};
  const lifeData = rankings["생활력"] || {};
  
  // 각 랭킹 데이터 로깅
  logger.info(`전투력 데이터: ${JSON.stringify(combatData)}`);
  logger.info(`매력 데이터: ${JSON.stringify(charmData)}`);
  logger.info(`생활력 데이터: ${JSON.stringify(lifeData)}`);
  
  // 전체 데이터 구성 (현재 API 형식에 맞추어 정확히 파싱)
  const data = {
    // 기본 캐릭터 정보
    character_name: apiData.character,
    server_name: apiData.server,
    class_name: combatData.class,  // 기본적으로 전투력 탭의 클래스 사용
    
    // 전투력 데이터 처리
    combat_rank: combatData.rank,
    combat_power: combatData.power,
    combat_change: combatData.change,
    combat_change_type: combatData.change_type,
    
    // 매력 데이터 처리
    charm_rank: charmData.rank,
    charm_power: charmData.power,
    charm_change: charmData.change,
    charm_change_type: charmData.change_type,
    
    // 생활력 데이터 처리
    life_rank: lifeData.rank,
    life_power: lifeData.power,
    life_change: lifeData.change,
    life_change_type: lifeData.change_type,
    
    // 기존 필드와 호환 유지
    rank_position: combatData.rank,
    power_value: combatData.power,
    change_amount: combatData.change,
    change_type: combatData.change_type
  };
  
  // 파싱된 데이터 로깅
  logger.info(`파싱된 API 데이터: ${JSON.stringify(data)}`);
  
  return data;
}

// 모든 대기 중인 사용자에게 랭킹 카드 전송 (DB 기반)
async function sendRankingToAllWaitingUsers(data, searchKey) {
  try {
    // DB에서 해당 searchKey의 모든 요청 조회
    const pendingRequests = await RankRequest.findBySearchKey(searchKey);
    if (!pendingRequests || pendingRequests.length === 0) {
      logger.error(`검색 정보를 찾을 수 없음: ${searchKey}`);
      return;
    }

    // 랭킹 카드 생성
    const rankingCard = await createRankingCard(data);
    
    // 각 대기 중인 사용자에게 전송
    for (const request of pendingRequests) {
      try {
        // Discord client 가져오기 - 첫 번째 요청의 interaction에서 가져오기
        const { client } = require('../../index'); // 메인 클라이언트 참조
        
        // 채널 객체 가져오기
        const channel = await client.channels.fetch(request.channelId);
        if (!channel) {
          logger.error(`채널을 찾을 수 없음: ${request.channelId}`);
          continue;
        }

        // 로딩 메시지 삭제
        try {
          if (request.loadingMessageId) {
            const loadingMessage = await channel.messages.fetch(request.loadingMessageId);
            await loadingMessage.delete();
            logger.info(`로딩 메시지 삭제 완료: ${request.loadingMessageId}`);
          }
        } catch (error) {
          logger.error('로딩 메시지 삭제 중 오류:', error.message);
        }
        
        // 먼저 멘션 메시지 전송
        await channel.send({
          content: `<@${request.userId}> 🎉 **${data.server_name || data.server} 서버의 ${data.character_name || data.character}** 랭킹 조회가 완료되었습니다!`
        });
        
        // 그 다음 랭킹 카드 전송
        await channel.send(rankingCard);
        
        logger.info(`랭킹 카드 전송 완료: ${request.userKey}`);

      } catch (error) {
        logger.error(`사용자 ${request.userKey}에게 랭킹 전송 중 오류:`, error);
      }
    }

    // 모든 요청 완료 처리
    await RankRequest.completeRequests(searchKey, 'completed');

  } catch (error) {
    logger.error('모든 대기 사용자에게 랭킹 전송 중 오류:', error);
  }
}

// 모든 대기 중인 사용자에게 오류 메시지 전송 (DB 기반)
async function sendErrorToAllWaitingUsers(errorMessage, searchKey) {
  try {
    // DB에서 해당 searchKey의 모든 요청 조회
    const pendingRequests = await RankRequest.findBySearchKey(searchKey);
    if (!pendingRequests || pendingRequests.length === 0) {
      logger.error(`검색 정보를 찾을 수 없음: ${searchKey}`);
      return;
    }

    // 각 대기 중인 사용자에게 전송
    for (const request of pendingRequests) {
      try {
        // Discord client 가져오기
        const { client } = require('../../index'); // 메인 클라이언트 참조
        
        // 채널 객체 가져오기
        const channel = await client.channels.fetch(request.channelId);
        if (!channel) {
          logger.error(`채널을 찾을 수 없음: ${request.channelId}`);
          continue;
        }

        // 로딩 메시지 삭제
        try {
          if (request.loadingMessageId) {
            const loadingMessage = await channel.messages.fetch(request.loadingMessageId);
            await loadingMessage.delete();
            logger.info(`로딩 메시지 삭제 완료: ${request.loadingMessageId}`);
          }
        } catch (error) {
          logger.error('로딩 메시지 삭제 중 오류:', error.message);
        }
        
        // 오류 메시지 전송
        await channel.send({
          content: `<@${request.userId}> ❌ 랭킹 조회 실패: ${errorMessage}`
        });

        logger.info(`오류 메시지 전송 완료: ${request.userKey}`);

      } catch (error) {
        logger.error(`사용자 ${request.userKey}에게 오류 메시지 전송 중 오류:`, error);
      }
    }

    // 모든 요청 실패 처리
    await RankRequest.completeRequests(searchKey, 'failed');

  } catch (error) {
    logger.error('모든 대기 사용자에게 오류 메시지 전송 중 오류:', error);
  }
}

// 랭킹 카드 생성 (기존 UI 로직 분리)
async function createRankingCard(data) {
  const cardImage = 'https://harmari.duckdns.org/static/ranking_card.png';
  
  // 캐릭터 정보 추출 및 키 매핑
  const name = data.character_name || data.character || '알 수 없음';
  const serverName = data.server_name || data.server || '알 수 없음';
  const className = data.class_name || data.class || '알 수 없음';
  
  // 전투력 랭킹 데이터 처리
  const combatRank = data.rank_position || data.combat_rank || '알 수 없음';
  const combatPower = data.power_value || data.combat_power || '알 수 없음';
  const combatRawChange = data.combat_change || data.change_amount || 0;
  let combatChange;
  try {
    // 콤마가 포함된 문자열이면 포맷팅을 제거한 후 변환
    if (typeof combatRawChange === 'string' && combatRawChange.includes(',')) {
      combatChange = parseInt(combatRawChange.replace(/,/g, ''), 10);
    } else {
      combatChange = parseInt(combatRawChange, 10);
    }
  } catch (e) {
    combatChange = 0;
  }
  const combatChangeType = data.combat_change_type || data.change_type || 'none';
  const combatEmoji = combatChange === 0 ? '-' : 
    combatChangeType === 'up' ? '🔺' : // 파란색 위쪽화살표 (U+1F53C)
    combatChangeType === 'down' ? '🔻' : // 빨간색 아래화살표 (U+1F53D)
    '-';
  
  // 매력 랭킹 데이터 처리
  const charmRank = data.charm_rank_formatted || data.charm_rank || '알 수 없음';
  const charmPower = data.charm_power_formatted || data.charm_power || '알 수 없음';
  const charmRawChange = data.charm_change || 0;
  let charmChange;
  try {
    // 콤마가 포함된 문자열이면 포맷팅을 제거한 후 변환
    if (typeof charmRawChange === 'string' && charmRawChange.includes(',')) {
      charmChange = parseInt(charmRawChange.replace(/,/g, ''), 10);
    } else {
      charmChange = parseInt(charmRawChange, 10);
    }
  } catch (e) {
    charmChange = 0;
  }
  const charmChangeType = data.charm_change_type || 'none';
  const charmEmoji = charmChange === 0 ? '-' : 
    charmChangeType === 'up' ? '🔺' : 
    charmChangeType === 'down' ? '🔻' : 
    '-';
  
  // 생활력 랭킹 데이터 처리
  const lifeRank = data.life_rank_formatted || data.life_rank || '알 수 없음';
  const lifePower = data.life_power_formatted || data.life_power || '알 수 없음';
  const lifeRawChange = data.life_change || 0;
  let lifeChange;
  try {
    // 콤마가 포함된 문자열이면 포맷팅을 제거한 후 변환
    if (typeof lifeRawChange === 'string' && lifeRawChange.includes(',')) {
      lifeChange = parseInt(lifeRawChange.replace(/,/g, ''), 10);
    } else {
      lifeChange = parseInt(lifeRawChange, 10);
    }
  } catch (e) {
    lifeChange = 0;
  }
  const lifeChangeType = data.life_change_type || 'none';
  const lifeEmoji = lifeChange === 0 ? '-' : 
    lifeChangeType === 'up' ? '🔺' : 
    lifeChangeType === 'down' ? '🔻' : 
    '-';

  // 직업 이름에서 '견습 ' 제거 (예: '견습 힐러' -> '힐러')
  const classNameWithoutSpace = className.replace(/견습\s+/g, '');
  
  // 클래스 아이콘 URL 생성 (환경 변수 체크)
  let classIconUrl = null;
  if (process.env.SERVER_IP && process.env.WEB_PORT) {
    classIconUrl = `http://${process.env.SERVER_IP}:${process.env.WEB_PORT}/images/class_icon/${classNameWithoutSpace}.png`;
  }
  
  const section = new SectionBuilder();
  
  // 클래스 아이콘이 있으면 추가
  if (classIconUrl) {
    section.setThumbnailAccessory(
      new ThumbnailBuilder().setURL(classIconUrl)
    );
  }
  
  section.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### <:__:1371226603702583486> 전투력 : ${combatPower}\n> ${combatRank}\n> \`${combatEmoji}${Math.abs(combatChange).toLocaleString('ko-KR')}\`\n`
    +
    `### <:__:1371226678478770276> 생활력 : ${lifePower}\n> ${lifeRank}\n> \`${lifeEmoji}${Math.abs(lifeChange).toLocaleString('ko-KR')}\`\n`
    +
    `### <:__:1371226630319509615> 매력 : ${charmPower}\n> ${charmRank}\n> \`${charmEmoji}${Math.abs(charmChange).toLocaleString('ko-KR')}\`\n`
    )
  )

  const textContent = `## [${serverName}] ${name} - ${className}`;
  const footerContent = `<:__:1372099666698698752> 정보는 거의 실시간 조회 중입니다. (약간의 오차가 있을 수 있음)`;

  // 5) Components V2 빌더로 컨테이너 생성
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems({
        media: { url: cardImage, type: 4 }
      })
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(textContent)
    )
    .addSectionComponents(section)
    .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerContent)
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

// 기존 UI로 결과 전송 (modalSubmit용 - 즉시 응답)
async function sendRankingResultWithOriginalUI(data, modalSubmit, user) {
  try {
    // 공통 랭킹 카드 생성 함수 사용
    const rankingCard = await createRankingCard(data);
    
    // modalSubmit으로 응답
    await modalSubmit.followUp(rankingCard);

  } catch (error) {
    logger.error('랭킹 결과 전송 중 오류:', error);
    await sendErrorMessage('결과 생성 중 오류가 발생했습니다.', modalSubmit, user);
  }
}

// 오류 메시지 전송
async function sendErrorMessage(errorMessage, modalSubmit, user) {
  try {
    await modalSubmit.followUp({
      content: `<@${user.id}> ❌ 랭킹 조회 실패: ${errorMessage}`
    });
  } catch (error) {
    logger.error('오류 메시지 전송 중 오류:', error);
  }
}