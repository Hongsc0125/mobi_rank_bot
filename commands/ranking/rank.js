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
      let data;
      try {
        const query = `
          SELECT character_name, server_name, class_name,
                 TO_CHAR(rank_position, 'FM999,999,999') || '위' AS rank_position,
                 TO_CHAR(power_value, 'FM999,999,999') AS power_value,
                 change_amount, change_type
          FROM mabinogi_ranking
          WHERE server_name = :server
            AND character_name = :character
            AND retrieved_at >= NOW() - INTERVAL '15 minutes'
          ORDER BY retrieved_at DESC
          LIMIT 1
        `;
        const result = await rankSequelize.query(query, {
          replacements: { server, character },
          type: Sequelize.QueryTypes.SELECT
        });
        if (result.length > 0) data = result[0];
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
            // API에서 응답을 그대로 사용
            data = res.data.character;
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
      const rank = data.rank_position || data.rank || '알 수 없음';
      const power = data.power_value || data.power || '알 수 없음';
      
      // Ensure change_amount is treated as int for logic, API might return string or int
      const rawChange = data.change_amount || data.change || 0;
      let change;
      try {
        change = parseInt(rawChange, 10);
      } catch (e) {
        change = 0;
      }
      
      const changeType = data.change_type || 'none';
      // 변화량이 0이면 '-', up이면 파란색 위쁘화살표, down이면 빨간색 아래화살표
      const emoji = change === 0 ? '-' : 
        changeType === 'up' ? '🔼' : // 파란색 위쁘화살표 (U+1F53C)
        changeType === 'down' ? '🔽' : // 빨간색 아래화살표 (U+1F53D)
        '-';

      const textContent =
        `## ${name} - ${className} [ ${serverName} ]\n\n` +
        `> 🏅 **서버랭킹** : ${rank}\n\n` +

        `> ⚔️ **전투력** : ${power}\n\n` +

        `> 📈 **순위 변동** : ${emoji} ${Math.abs(
          change
        ).toLocaleString('ko-KR')}`;


      const footerContent = `⏱️ *정보는 거의 실시간 조회 중입니다. (약간의 오차가 있을 수 있음)*`;

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
