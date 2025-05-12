const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  AttachmentBuilder,
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

      await modalSubmit.deferReply();

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
          
          if (result.length > 0) {
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
          }
        }
      } catch (e) {
        logger.error(`DB 오류: ${e.message}`);
      }

      if (!data) {
        try {
          const res = await axios.post(
            settings.RANK_API_URL,
            { server, character },
            { timeout: 30000 }
          );
          if (res.data.success) {
            // API에서 응답을 받아 파싱 (새로운 형식)
            const apiData = res.data.character;
            const rankings = apiData.rankings || {};
            
            // 랜킹 데이터 추출 (기본값은 전투력 - div=1)
            const combatData = rankings["전투력"]?.data?.[0] || {};
            const charmData = rankings["매력"]?.data?.[0] || {};
            const lifeData = rankings["생활력"]?.data?.[0] || {};
            
            // 기본적으로 전투력 랜킹 데이터를 사용
            data = {
              character_name: apiData.character || combatData.character_name,
              server_name: apiData.server || combatData.server_name,
              class_name: combatData.class_name,
              // 각 랜킹 타입처럼 div 구분
              combat_rank: combatData.rank_position,
              combat_power: combatData.power_value,
              combat_change: combatData.change_amount,
              combat_change_type: combatData.change_type,
              
              charm_rank: charmData.rank_position,
              charm_power: charmData.power_value,
              charm_change: charmData.change_amount,
              charm_change_type: charmData.change_type,
              
              life_rank: lifeData.rank_position,
              life_power: lifeData.power_value,
              life_change: lifeData.change_amount,
              life_change_type: lifeData.change_type,
              
              // 기존 형태와의 호환을 위해 추가
              rank_position: combatData.rank_position,
              power_value: combatData.power_value,
              change_amount: combatData.change_amount,
              change_type: combatData.change_type
            };
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
      const combatRank = data.combat_rank || data.rank_position || '알 수 없음';
      const combatPower = data.combat_power || data.power_value || '알 수 없음';
      const combatRawChange = data.combat_change || data.change_amount || 0;
      let combatChange;
      try {
        combatChange = parseInt(combatRawChange, 10);
      } catch (e) {
        combatChange = 0;
      }
      const combatChangeType = data.combat_change_type || data.change_type || 'none';
      const combatEmoji = combatChange === 0 ? '-' : 
        combatChangeType === 'up' ? '🔺' : // 파란색 위븠화살표 (U+1F53C)
        combatChangeType === 'down' ? '🔻' : // 빨간색 아래화살표 (U+1F53D)
        '-';
      
      // 매력 랭킹 데이터 처리
      const charmRank = data.charm_rank_formatted || (data.charm_rank ? data.charm_rank + '위' : '알 수 없음');
      const charmPower = data.charm_power_formatted || (data.charm_power ? Number(data.charm_power).toLocaleString('ko-KR') : '알 수 없음');
      const charmRawChange = data.charm_change || 0;
      let charmChange;
      try {
        charmChange = parseInt(charmRawChange, 10);
      } catch (e) {
        charmChange = 0;
      }
      const charmChangeType = data.charm_change_type || 'none';
      const charmEmoji = charmChange === 0 ? '-' : 
        charmChangeType === 'up' ? '🔺' : 
        charmChangeType === 'down' ? '🔻' : 
        '-';
      
      // 생활력 랭킹 데이터 처리
      const lifeRank = data.life_rank_formatted || (data.life_rank ? data.life_rank + '위' : '알 수 없음');
      const lifePower = data.life_power_formatted || (data.life_power ? Number(data.life_power).toLocaleString('ko-KR') : '알 수 없음');
      const lifeRawChange = data.life_change || 0;
      let lifeChange;
      try {
        lifeChange = parseInt(lifeRawChange, 10);
      } catch (e) {
        lifeChange = 0;
      }
      const lifeChangeType = data.life_change_type || 'none';
      const lifeEmoji = lifeChange === 0 ? '-' : 
        lifeChangeType === 'up' ? '🔺' : 
        lifeChangeType === 'down' ? '🔻' : 
        '-';

      const textContent =
        `## [ ${serverName} ] ${name} - ${className} \n\n` +
        `### <:__:1371226603702583486> 전투력\n` +
        `> **랭킹** : ${combatRank}\n` +
        `> **점수** : ${combatPower}\n` +
        `> **변동** : ${combatEmoji} ${Math.abs(combatChange).toLocaleString('ko-KR')}\n\n` +
        
        `### <:__:1371226630319509615> 매력\n` +
        `> **랭킹** : ${charmRank}\n` +
        `> **점수** : ${charmPower}\n` +
        `> **변동** : ${charmEmoji} ${Math.abs(charmChange).toLocaleString('ko-KR')}\n\n` +
        
        `### <:__:1371226678478770276> 생활력\n` +
        `> **랭킹** : ${lifeRank}\n` +
        `> **점수** : ${lifePower}\n` +
        `> **변동** : ${lifeEmoji} ${Math.abs(lifeChange).toLocaleString('ko-KR')}`;

         
      const footerContent = `<:__:1371228573146419372> *정보는 거의 실시간 조회 중입니다. (약간의 오차가 있을 수 있음)*`;

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
        .addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
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
