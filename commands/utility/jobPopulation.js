const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  MediaGalleryBuilder,
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('직업별인구')
    .setDescription('직업별 인구 통계를 조회합니다'),

  async execute(interaction) {
    try {
      await interaction.deferReply({ content: '직업별 인구 통계 조회중입니다... (최대 60초까지 소요될 수 있습니다)', flags: MessageFlags.IsComponentsV2 });

      const response = await axios.get('https://thorough-possibly-zebra.ngrok-free.app/class-chart', {
        timeout: 60000
      });

      if (!response.data.success) {
        return interaction.editReply('직업별 인구 데이터를 불러오는데 실패했습니다.');
      }

      const jobData = response.data.data.map(job => ({
        job_name: String(job.job_name || ''),
        population: String(job.population || '0'),
        percentage: String(job.percentage || '0')
      }));
      const imageUrl = String(response.data.imageUrl || '');
      const chartImageUrl = String(response.data.chartImageUrl || '');
      const tableImageUrl = String(response.data.tableImageUrl || '');
      const timestamp = String(response.data.timestamp || '');
      const totalPopulation = parseInt(response.data.total_population || '0').toLocaleString('ko-KR');

      // 제목과 이미지 URL 설정
      const titleImage = 'https://harmari.duckdns.org/static/population.png';
      
      // 직업별 인구 데이터 텍스트 생성
      let jobText = '## 직업별 인구 통계\n\n';
      jobText += `> 전체 인구수: ${totalPopulation}명\n`;
      jobText += '> ─────────────────────────────\n';

      // 각 직업의 데이터 추가
      jobData.forEach((job, index) => {
        const formattedPopulation = parseInt(job.population, 10).toLocaleString('ko-KR');
        jobText += `> **${index + 1}. ${job.job_name}**: ${formattedPopulation} 명 (${job.percentage}%)\n`;
      });
      
      // 업데이트 시간 정보 추가
      const footerText = `⏱️ *마지막 업데이트: ${timestamp}*`;

      // 그래프/테이블 이미지 URL 변수 생성
      const graphImageUrl = `https://thorough-possibly-zebra.ngrok-free.app${chartImageUrl}`;
      const tableImgUrl = `https://thorough-possibly-zebra.ngrok-free.app${tableImageUrl}`;
      
      // 데이터 로그 출력
      console.log('=== 직업별 인구 명령어 로그 ===');
      console.log('✨ 서버 이미지 URL:', titleImage);
      console.log('✨ 그래프 이미지 URL:', graphImageUrl);
      console.log('✨ 원본 이미지 경로:', chartImageUrl);
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
        const graphBuffer = Buffer.from(graphResponse.data);
        const uniqueId = Date.now() + '_' + Math.floor(Math.random() * 10000);
        const graphFileName = `job_population_graph_${uniqueId}.png`;
        const graphImagePath = path.join(process.cwd(), 'images', graphFileName);
        fs.writeFileSync(graphImagePath, graphBuffer);
        const graphImageUrlLocal = `http://${process.env.SERVER_IP}:${process.env.WEB_PORT}/images/${graphFileName}`;

        // 2. 테이블 이미지 다운로드
        let tableImageUrlLocal = null;
        try {
          console.log('🔍 테이블 이미지 다운로드 시도:', tableImgUrl);
          const tableResponse = await axios.get(tableImgUrl, {
            responseType: 'arraybuffer',
            timeout: 10000
          });
          const tableBuffer = Buffer.from(tableResponse.data);
          const tableFileName = `job_population_table_${uniqueId}.png`;
          const tableImagePath = path.join(process.cwd(), 'images', tableFileName);
          fs.writeFileSync(tableImagePath, tableBuffer);
          tableImageUrlLocal = `http://${process.env.SERVER_IP}:${process.env.WEB_PORT}/images/${tableFileName}`;
        } catch (tableErr) {
          console.error('❌ 직업별 인구 테이블 이미지 다운로드 오류:', tableErr.message);
        }

        // 3. 컨테이너 생성 - 두 이미지 모두 MediaGallery에 추가
        const mediaItems = [
          { media: { url: graphImageUrlLocal, type: 4 } }
        ];
        if (tableImageUrlLocal) {
          mediaItems.push({ media: { url: tableImageUrlLocal, type: 4 } });
        }
        const container = new ContainerBuilder()
          .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(...mediaItems)
          )
          .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
          )
          // .addTextDisplayComponents(
          //   new TextDisplayBuilder().setContent(jobText)
          // )
          // .addSeparatorComponents(
          //   new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
          // )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(footerText)
          );

        await interaction.editReply({
          components: [container],
          flags: MessageFlags.IsComponentsV2
        });
        
      } catch (imageError) {
        // 이미지 다운로드 실패 시 원래 URL 사용
        console.error('❌ 직업별 인구 그래프 이미지 다운로드 오류:', imageError.message);
        
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
            new TextDisplayBuilder().setContent(jobText)
          )
          .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(footerText)
          );
        
        await interaction.editReply({
          components: [container],
          flags: MessageFlags.IsComponentsV2 
        });
      }
    } catch (error) {
      logger.error(`직업별 인구 명령어 처리 중 오류: ${error.message}`);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '직업별 인구 데이터를 불러오는 중 오류가 발생했습니다.',
          ephemeral: true
        });
      } else {
        await interaction.editReply({
          content: '직업별 인구 데이터를 불러오는 중 오류가 발생했습니다.',
          components: []
        });
      }
    }
  }
};
