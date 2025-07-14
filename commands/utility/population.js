const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { logger } = require('../../db/session');
const settings = require('../../core/config');
const rankUrl = settings.RANK_API_URL;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('인구')
    .setDescription('서버별 인구 통계를 조회합니다'),

  async execute(interaction) {
    try {
      // (1) 슬래시 명령 접수 직후
      await interaction.deferReply({ content: '실시간 인구 통계 조회중입니다... (최대 60초까지 소요될 수 있습니다)', flags: MessageFlags.IsComponentsV2 });

      // API에서 인구 데이터 조회
      const response = await axios.get(rankUrl + '/population', {
        timeout: 60000
      });

      if (!response.data.success) {
        return interaction.editReply('인구 데이터를 불러오는데 실패했습니다.');
      }

      const populationData = response.data.data.map(server => ({
        server_name: String(server.server_name || ''),
        population: String(server.population || '0')
      }));
      const imageUrl = String(response.data.imageUrl || '');
      const timestamp = String(response.data.timestamp || '');

      // 제목과 이미지 URL 설정
      const titleImage = 'https://harmari.duckdns.org/static/population2.png';
      
      // 서버별 인구 데이터 텍스트 생성
      let populationText = '## 서버별 인구 통계\n\n';

      // 각 서버의 데이터 추가
      populationData.forEach((server, index) => {
        const formattedPopulation = parseInt(server.population, 10).toLocaleString('ko-KR');
        populationText += `> **${index + 1}. ${server.server_name}**: ${formattedPopulation} 명\n`;
      });
      
      // 업데이트 시간 정보 추가
      const footerText = `⏱️ *마지막 업데이트: ${timestamp}*`;




      // 그래프 이미지 URL 변수 생성
      const graphImageUrl = `${rankUrl}${imageUrl}`;
      // const graphImageUrl = `https://thorough-possibly-zebra.ngrok-free.app${imageUrl}`;

      // 데이터 로그 출력
      console.log('=== 인구 명령어 로그 ===');
      console.log('✨ 서버 이미지 URL:', titleImage);
      console.log('✨ 그래프 이미지 URL:', graphImageUrl);
      console.log('✨ 원본 이미지 경로:', imageUrl);
      console.log('✨ 타임스태프:', timestamp);
      console.log('======================');
      
      // 이미지 다운로드 시도
      try {
        // 1. 그래프 이미지 다운로드
        console.log('🔍 그래프 이미지 다운로드 시도:', graphImageUrl);
        const graphResponse = await axios.get(graphImageUrl, { 
          responseType: 'arraybuffer',
          timeout: 10000
        });
        
        // 2. 이미지 처리 - 고유 파일명 생성
        const graphBuffer = Buffer.from(graphResponse.data);
        const uniqueId = Date.now() + '_' + Math.floor(Math.random() * 10000);
        const graphFileName = `population_graph_${uniqueId}.png`;
        
        // 이미지를 images 폴더에 저장
        const imagePath = path.join(process.cwd(), 'images', graphFileName);
        fs.writeFileSync(imagePath, graphBuffer);
        
        // 외부 접근용 URL 생성
        const imageUrl = `/images/${graphFileName}`; // 상대경로
        const publicImageUrl = `http://${process.env.SERVER_IP}:${process.env.WEB_PORT}${imageUrl}`; // 절대경로, 실제 서버 URL로 변경 필요
        
        // 첨부파일로도 유지
        const graphAttachment = new AttachmentBuilder(graphBuffer, { name: graphFileName });
        
        console.log('🔑 고유 이미지 ID 생성:', uniqueId);
        console.log('💾 이미지 파일 저장 경로:', imagePath);
        console.log('🌐 이미지 공개 URL:', publicImageUrl);
        console.log('✅ 그래프 이미지 크기:', graphBuffer.length, 'bytes');
        
        // 3. 컨테이너 생성 - attachment:// 방식으로 이미지 참조
        const container = new ContainerBuilder()
          .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems({
              media: { url: titleImage, type: 4 }
            })
          )
          .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
          )
          .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems({
              media: { url: publicImageUrl, type: 4 } // 저장한 이미지의 공개 URL 사용
            })
          )
          .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(footerText)
          )

        // 4. 첨부파일과 함께 메시지 전송
        await interaction.editReply({
          components: [container],
          flags: MessageFlags.IsComponentsV2
        });
        
      } catch (imageError) {
        // 이미지 다운로드 실패 시 원래 URL 사용
        console.error('❌ 이미지 다운로드 오류:', imageError.message);
        
        const container = new ContainerBuilder()
          .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems({
              media: { url: titleImage, type: 4 }
            })
          )
          .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(populationText)
          )
          
        await interaction.editReply({
          components: [container],
          flags: MessageFlags.IsComponentsV2 
        });
      }
    } catch (error) {
      logger.error(`인구 명령어 처리 중 오류: ${error.message}`);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '인구 데이터를 불러오는 중 오류가 발생했습니다.',
          ephemeral: true
        });
      } else {
        await interaction.editReply({
          content: '인구 데이터를 불러오는 중 오류가 발생했습니다.',
          components: []
        });
      }
    }
  }
};
