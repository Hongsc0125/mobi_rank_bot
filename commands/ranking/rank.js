const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  AttachmentBuilder,
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

      await modalSubmit.deferReply({ content: '실시간 랭킹 조회중입니다... (최대 60초까지 소요될 수 있습니다)' });

      // 3) DB 또는 API에서 데이터 조회
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
                AND retrieved_at >= NOW() - INTERVAL '15 minutes'
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
                AND retrieved_at >= NOW() - INTERVAL '15 minutes'
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

      const url = settings.RANK_API_URL + '/search';

      // data 객체가 비어있는지 확인 (Object.keys를 사용하여 정확하게 체크)
      if (Object.keys(data).length === 0) {
        try {
          const res = await axios.post(
            url,
            { server, character },
            { timeout: 60000 }
          );
          if (res.data.success) {
            // API 응답 로깅
            logger.info(`API 응답: ${JSON.stringify(res.data)}`);
            
            // API에서 응답을 받아 파싱 (2025.05.12 기준 최신 형식)
            const apiData = res.data.character;
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
            data = {
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
          
          }
          else
            return modalSubmit.followUp(
              `데이터 조회 실패: ${res.data.message}`
            );
        } catch (e) {
          logger.error(`API 오류: ${e.message}`);
          return modalSubmit.followUp(
            'API 오류 발생. 나중에 다시 시도해주세요.'
          );
        }
      }

      // 4) 텍스트 및 이미지 준비
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
        combatChangeType === 'up' ? '🔺' : // 파란색 위븠화살표 (U+1F53C)
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


    // 
    
    // 직업 이름에서 '견습 ' 제거 (예: '견습 힐러' -> '힐러')
    const classNameWithoutSpace = className.replace(/견습\s+/g, '');
    
    const section = new SectionBuilder()
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(`http://${process.env.SERVER_IP}:${process.env.WEB_PORT}/images/class_icon/${classNameWithoutSpace}.png`)
    )
    .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### <:__:1371226603702583486> 전투력 : ${combatPower}\n> ${combatRank}\n> \`${combatEmoji}${Math.abs(combatChange).toLocaleString('ko-KR')}\`\n`
      +
      `### <:__:1371226678478770276> 생활력 : ${lifePower}\n> ${lifeRank}\n> \`${lifeEmoji}${Math.abs(lifeChange).toLocaleString('ko-KR')}\`\n`
      +
      `### <:__:1371226630319509615> 매력 : ${charmPower}\n> ${charmRank}\n> \`${charmEmoji}${Math.abs(charmChange).toLocaleString('ko-KR')}\`\n`
      )
    )
    // <:__:1372099666698698752> 그래프아이콘
    // <:__:1371226678478770276> 시례아이콘



      const textContent =
        `## [${serverName}] ${name} - ${className}`
        // `### <:__:1371226603702583486> 전투력\n` +
        // `> **랭킹** : ${combatRank}\n` +
        // `> **점수** : ${combatPower}\n` +
        // `> **변동** : ${combatEmoji} ${Math.abs(combatChange).toLocaleString('ko-KR')}\n\n` +
        
        // `### <:__:1371226630319509615> 매력\n` +
        // `> **랭킹** : ${charmRank}\n` +
        // `> **점수** : ${charmPower}\n` +
        // `> **변동** : ${charmEmoji} ${Math.abs(charmChange).toLocaleString('ko-KR')}\n\n` +
        
        // `### <:__:1371226678478770276> 생활력\n` +
        // `> **랭킹** : ${lifeRank}\n` +
        // `> **점수** : ${lifePower}\n` +
        // `> **변동** : ${lifeEmoji} ${Math.abs(lifeChange).toLocaleString('ko-KR')}`;

         
      const footerContent = `<:__:1372099666698698752> 정보는 거의 실시간 조회 중입니다. (약간의 오차가 있을 수 있음)`;

      // 5) Components V2 빌더로 컨테이너 생성 :contentReference[oaicite:0]{index=0}
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

      // 6) V2 플래그와 함께 메시지 전송 :contentReference[oaicite:1]{index=1}
      await modalSubmit.followUp({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    } catch (error) {
      logger.error(`랭크 명령 오류: ${error.message}`);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '오류가 발생했습니다.',
          ephemeral: true
        });
      } else {
        await interaction.followUp({
          content: '오류가 발생했습니다.',
          ephemeral: true
        });
      }
    }
  }
};
