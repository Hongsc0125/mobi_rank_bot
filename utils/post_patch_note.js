// 알림 관리자 이벤트 모듈
const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
const { Sequelize } = require('sequelize');
const { kadanSequelize, logger } = require('../db/session');
const settings = require('../core/config');
const { DateTime } = require('luxon');
const { JSDOM } = require('jsdom');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function sendDiscordMessage(client) {
try {
  // 클라이언트 유효성 검사
  if (!client || !client.channels || typeof client.channels.fetch !== 'function') {
    throw new Error('Discord 클라이언트가 유효하지 않습니다.');
  }
  
  // 전체 채널 ID 가져오기
  const channelIds = await getChannelIds();
  if (!channelIds || channelIds.length === 0) {
    throw new Error('패치 노트를 게시할 채널 ID를 찾을 수 없습니다.');
  }
  
  logger.info(`[패치노트] ${channelIds.length}개 채널에 전송 시도`);
  
  // 최신 패치노트 데이터 가져오기
  const patchDataList = await getLatestPatchData();
  if (!patchDataList || patchDataList.length === 0) {
    throw new Error('패치 노트 데이터를 가져올 수 없습니다.');
  }
  
  const threadIds = [];
  
  // 각 채널에 패치노트 전송
  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel) {
        logger.warn(`[패치노트] 채널을 찾을 수 없습니다 (ID: ${channelId})`);
        continue;
      }
      
      // 채널 타입 확인 (Discord 포럼 채널 타입은 15)
      if (channel.type !== 15) {
        logger.warn(`[패치노트] 채널 타입이 포럼이 아닙니다: ${channel.type} (ID: ${channelId})`);
        continue;
      }
      
      logger.info(`[패치노트] 채널 '${channel.name}'에 패치 노트 전송 시작`);
      
      // 이미 생성된 쓰레드 목록 가져오기
      let existingThreads = [];
      try {
        // 활성 쓰레드와 보관된 쓰레드 모두 가져오기
        const activeThreads = await channel.threads.fetchActive();
        const archivedThreads = await channel.threads.fetchArchived();
        
        existingThreads = [
          ...Array.from(activeThreads.threads.values()),
          ...Array.from(archivedThreads.threads.values())
        ];
      } catch (e) {
        logger.warn(`[패치노트] 기존 쓰레드 가져오기 실패: ${e.message}`);
      }
      
      // 각 패치노트에 대해 처리
      for (const patchData of patchDataList) {
        const title = patchData.title || `패치노트 ${new Date().toLocaleString('ko-KR')}`;
        const post_date = patchData.post_date || new Date().toLocaleString('ko-KR');
        
        // 이미 같은 제목의 쓰레드가 있는지 확인
        const existingThread = existingThreads.find(thread => 
          thread.name.toLowerCase().includes(title.toLowerCase()) || 
          title.toLowerCase().includes(thread.name.toLowerCase())
        );
        
        if (existingThread) {
          logger.info(`[패치노트] 이미 생성된 쓰레드가 있습니다: ${existingThread.name} (ID: ${existingThread.id})`);
          threadIds.push(existingThread.id);
          continue;
        }
        
        // 패치노트 내용 추출
        let content = '';
        let url = '';
        
        if (patchData.contents_json) {
          if (typeof patchData.contents_json === 'string') {
            try {
              const jsonObj = JSON.parse(patchData.contents_json);
              content = jsonObj.content || jsonObj.content_html || jsonObj.html || '';
              url = jsonObj.url || jsonObj.link || '';
            } catch (e) {
              content = patchData.contents_json;
            }
          } else if (typeof patchData.contents_json === 'object') {
            content = patchData.contents_json.content || patchData.contents_json.content_html || patchData.contents_json.html || '';
            url = patchData.contents_json.url || patchData.contents_json.link || '';
          }
        }
        
        if (!content || content.trim() === '') {
          content = `<p>패치노트 제목: ${title}</p><p>날짜: ${post_date}</p>`;
        }
        
        // 스레드 생성
        try {
          const thread = await channel.threads.create({
            name: title || `패치노트 ${new Date().toLocaleString('ko-KR')}`,
            autoArchiveDuration: 4320,
            reason: '패치노트 게시',
            message: {
              content: `${title}`
            }
          });
          
          logger.info(`[패치노트] 포럼 스레드 생성 완료 (ID: ${thread.id})`);
          
          // 내용 처리 및 전송
          await processAndSendContent(thread, content, {
            title,
            url,
            post_date
          });
          
          threadIds.push(thread.id);
        } catch (e) {
          logger.error(`[패치노트] 스레드 생성 실패: ${e.message}`);
        }
      }
    } catch (channelError) {
      logger.error(`[패치노트] 채널 처리 중 오류: ${channelError.message}`);
    }
  }
  
  return threadIds;
} catch (error) {
  logger.error(`[패치노트] 전송 오류: ${error.message}`);
  logger.error(error.stack);
  throw error;
}
}

async function getChannelIds() {
  const query = `
      SELECT patch_ch_id
      FROM guilds
      WHERE patch_ch_id IS NOT NULL
  `;
  const channelIds = await kadanSequelize.query(query, {
    type: Sequelize.QueryTypes.SELECT
  });
  
  if (channelIds && channelIds.length > 0) {
    return channelIds.map(channel => channel.patch_ch_id).filter(id => id);
  }
  return [];
}

async function getLatestPatchData() {
try {
  const query = `
    SELECT title, post_date, contents_json, scraped_at, id
    FROM patch_note_data
    ORDER BY scraped_at DESC
  `;
  const results = await kadanSequelize.query(query, {
    type: Sequelize.QueryTypes.SELECT
  });
  
  if (!results || results.length === 0) {
    logger.error('패치 노트 데이터를 찾을 수 없습니다.');
    return [];
  }
  
  // 조회된 모든 데이터 처리
  return results.map(patchData => {
    let parsedContentsJson;
    
    try {
      if (typeof patchData.contents_json === 'string') {
        parsedContentsJson = JSON.parse(patchData.contents_json);
      } else if (typeof patchData.contents_json === 'object') {
        parsedContentsJson = patchData.contents_json;
      } else {
        throw new Error(`올바르지 않은 contents_json 타입: ${typeof patchData.contents_json}`);
      }
    } catch (error) {
      logger.error(`JSON 파싱 오류: ${error.message}`);
      parsedContentsJson = { content: '', url: '' };
    }
    
    // 결과 생성
    return {
      title: patchData.title,
      post_date: patchData.post_date,
      contents_json: parsedContentsJson || {},
      id: patchData.id
    };
  });
} catch (error) {
  logger.error(`패치 노트 데이터 가져오기 오류: ${error.message}`);
  logger.error(error.stack);
  return [];
}
}

// HTML 콘텐츠를 처리하는 함수 - Components V2 사용
async function processAndSendContent(thread, contentHtml, options = {}) {
try {
  if (!contentHtml || contentHtml.trim() === '') {
    logger.warn('[패치노트] 패치 노트 내용이 비어 있습니다.');
    return false;
  }

  const { url = '', title = '', post_date = '' } = options;
  const dom = new JSDOM(contentHtml);
  const nodes = Array.from(dom.window.document.body.childNodes);
  const attachments = [];
  
  logger.info(`[패치노트] 총 ${nodes.length}개 노드 처리 시작`);
  
  // 총 메시지 수 추적
  let messageCount = 0;
  
  // 패치노트 부분 번호
  let partNumber = 1;
  
  // 컨테이너 제한
  const MAX_MEDIA_COUNT = 5;     // 최대 미디어 갤러리 개수 제한
  const MAX_COMPONENT_COUNT = 30;  // 최대 컴포넌트 개수 제한 (여유있게 40보다 작게 설정)

  let currentContainers = [];
  let currentContainer = new ContainerBuilder();
  let currentComponentCount = 0;  // 일반 추적용으로 유지
  let mediaGalleryCount = 0;     // 현재 컨테이너의 미디어 갤러리 개수 추적
  
  // 현재 컨테이너 전송 함수
  const sendCurrentContainer = async () => {
    if (currentComponentCount > 0) {
      try {
        await thread.send({
          components: [currentContainer],
          flags: MessageFlags.IsComponentsV2
        });
        messageCount++;
        
        logger.info(`[패치노트] 부분 ${partNumber} 전송 완료 (미디어 갤러리: ${mediaGalleryCount}개)`);
        partNumber++;
        
        // 새 컨테이너 준비
        currentContainer = new ContainerBuilder();
        currentComponentCount = 0;
        mediaGalleryCount = 0; // 미디어 갤러리 개수 초기화
        currentComponentCount += 2;
        
        // API 제한 방지를 위한 딩레이
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        logger.error(`[패치노트] 메시지 전송 오류: ${error.message}`);
      }
    }
  };
  
  // 첫 번째 컨테이너에 헤더 추가
  currentContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**${title}**`)
  );
  currentContainer.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );
  currentComponentCount += 2;
  
  // 각 노드별 처리
  for (const node of nodes) {
    // 이미지 태그 처리
    if (node.nodeName === 'P' && node.querySelector && node.querySelector('img')) {
      const img = node.querySelector('img');
      const imgSrc = img.getAttribute('src');
      
      if (imgSrc) {
        // 이미지 URL 추출 (상대 경로일 경우 절대 경로로 변환)
        const imageUrl = imgSrc.startsWith('http') ? imgSrc : (options.baseUrl ? new URL(imgSrc, options.baseUrl).href : imgSrc);
        
        // 컴포넌트 개수 제한 및 미디어 갤러리 개수 제한 체크
        
        // 전체 컴포넌트 개수 체크
        if (currentComponentCount >= MAX_COMPONENT_COUNT) {
          logger.info(`[패치노트] 컴포넌트 ${currentComponentCount}개 도달 - 메시지 전송`);
          await sendCurrentContainer();
        }
        
        // 이미지 추가
        currentContainer.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems({
            media: { url: imageUrl, type: 4 }
          })
        );
        currentComponentCount++;
        mediaGalleryCount++; // 미디어 갤러리 개수 증가
        
        // 미디어 갤러리 개수 체크
        if (mediaGalleryCount >= MAX_MEDIA_COUNT) {
          logger.info(`[패치노트] 미디어 갤러리 ${mediaGalleryCount}개 도달 - 메시지 전송`);
          await sendCurrentContainer();
          mediaGalleryCount = 0;
        }
      }
      continue;
    }
    
    // 테이블 처리 (테이블은 이미지로 변환)
    if (node.nodeName === 'TABLE') {
      try {
        // 컴포넌트 개수 제한 및 미디어 갤러리 개수 제한 체크
        
        // 테이블 HTML을 이미지로 변환
        const html = node.outerHTML;
        // 테이블 HTML 구조 로깅
        // logger.info(`[패치노트] 테이블 HTML 구조: ${html.substring(0, 500)}...`);
        
        // tr, td 요소 확인
        const dom = new JSDOM(html);
        const trCount = dom.window.document.querySelectorAll('tr').length;
        const tdCount = dom.window.document.querySelectorAll('td').length;
        // logger.info(`[패치노트] 테이블 구조 분석: tr 개수=${trCount}, td 개수=${tdCount}`);
        
        const imageUrl = await htmlTableToImageBuffer(html);
        
        if (imageUrl) {
          logger.info(`[패치노트] 테이블 이미지 생성 성공: ${imageUrl}`);
          
          // 전체 컴포넌트 개수 체크
          if (currentComponentCount >= MAX_COMPONENT_COUNT) {
            logger.info(`[패치노트] 컴포넌트 ${currentComponentCount}개 도달 - 메시지 전송`);
            await sendCurrentContainer();
          }
          
          // 테이블 이미지 추가
          currentContainer.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems({
              media: { url: imageUrl, type: 4 }
            })
          );
          currentComponentCount++;
          mediaGalleryCount++; // 미디어 갤러리 개수 증가
          
          // 파일이름만 추출해서 attachments 배열에 추가
          const fileName = imageUrl.split('/').pop();
          if (fileName) {
            attachments.push(fileName);
          }
          
          // 미디어 갤러리 개수 체크
          if (mediaGalleryCount >= MAX_MEDIA_COUNT) {
            logger.info(`[패치노트] 미디어 갤러리 ${mediaGalleryCount}개 도달 - 메시지 전송`);
            await sendCurrentContainer();
            mediaGalleryCount = 0;
          }
        }
      } catch (error) {
        logger.error(`[패치노트] 테이블 이미지 변환 오류: ${error.message}`);
        // 오류 발생시 텍스트로 표시
        currentContainer.addTextDisplayComponents(
          new TextDisplayBuilder().setContent('테이블 변환 오류 - 원본을 참조해주세요')
        );
        currentComponentCount++;
      }
      continue;
    }
    
    // 텍스트 단락 처리
    if (node.nodeName === 'P') {
      const text = node.textContent.trim();
      if (text) {
        // 전체 컴포넌트 개수 체크
        if (currentComponentCount >= MAX_COMPONENT_COUNT) {
          logger.info(`[패치노트] 컴포넌트 ${currentComponentCount}개 도달 - 메시지 전송`);
          await sendCurrentContainer();
        }
        
        // 텍스트 추가
        currentContainer.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(text)
        );
        currentComponentCount++;
      }
      continue;
    }
    
    // 제목 처리 (H1-H6)
    if (node.nodeName.match(/^H[1-6]$/)) {
      const text = `**${node.textContent.trim()}**`;
      if (text) {
        // 전체 컴포넌트 개수 체크
        if (currentComponentCount >= MAX_COMPONENT_COUNT) {
          logger.info(`[패치노트] 컴포넌트 ${currentComponentCount}개 도달 - 메시지 전송`);
          await sendCurrentContainer();
        }
        
        // 제목 추가
        currentContainer.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(text)
        );
        currentComponentCount++;
      }
      continue;
    }
    
    // 구분선 처리
    if (node.nodeName === 'HR') {
      // 전체 컴포넌트 개수 체크
      if (currentComponentCount >= MAX_COMPONENT_COUNT) {
        logger.info(`[패치노트] 컴포넌트 ${currentComponentCount}개 도달 - 메시지 전송`);
        await sendCurrentContainer();
      }
      
      // 구분선 추가
      currentContainer.addSeparatorComponents(
        new SeparatorBuilder()
          .setSpacing(SeparatorSpacingSize.Small)
          .setDivider(true)
      );
      currentComponentCount++;
      continue;
    }
  }
  
  // 마지막 푸터 추가
  if (url || title || post_date) {
    // 구분선 추가
    currentContainer.addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    );
    currentComponentCount++;
    
    // 푸터
    currentContainer
    .addActionRowComponents(
      new ActionRowBuilder()
          .addComponents(
              new ButtonBuilder()
                  .setStyle(ButtonStyle.Link)
                  .setLabel(`공식홈페이지 : ${title}`)
                  .setURL(url),
          ),
    );
    currentComponentCount++;
  }
  
  // 마지막 컨테이너 전송
  if (currentComponentCount > 0) {
    await thread.send({
      components: [currentContainer],
      flags: MessageFlags.IsComponentsV2
    });
    messageCount++;
  }
  
  logger.info(`[패치노트] 콘텐츠 처리 완료. 총 ${messageCount}개 메시지 전송`);
  return messageCount;
} catch (error) {
  logger.error(`[패치노트] 콘텐츠 처리 및 전송 오류: ${error.message}`);
  logger.error(error.stack);
  throw error;
}
}

// HTML 테이블을 이미지로 변환하는 함수
async function htmlTableToImageBuffer(html) {
  try {
    // HTML 구조 전처리 - 빈 테이블 셀 처리 및 테이블 구조 보정
    const processedHtml = html.replace(/<td[^>]*>\s*<\/td>/g, '<td>&nbsp;</td>');
    
    // 기본 스타일이 적용된 HTML 템플릿 설정
    const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Noto Sans KR', Arial, sans-serif; background-color: white; padding: 20px; }
        table { border-collapse: collapse; width: 100%; max-width: 800px; margin: 0 auto; table-layout: fixed; }
        table, td, th { border: 1px solid #ddd; }
        td, th { padding: 8px; text-align: center; word-break: break-word; }
        th { background-color: #333; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        td:empty { padding: 8px; }
      </style>
    </head>
    <body>
      ${processedHtml}
    </body>
    </html>
`;
    
    logger.info(`[패치노트] HTML 테이블 변환 시작`);
    
    // API 서버에 HTML 전송하여 이미지 URL 받기
    const rankUrl = settings.RANK_API_URL;
    
    // HTML을 API로 전송하여 이미지 URL 받기
    const response = await axios.post(`${rankUrl}/html_to_image`, {
      html: htmlTemplate
    }, {
      timeout: 30000
    });
    
    if (!response.data || !response.data.success) {
      throw new Error('이미지 변환 API 응답이 유효하지 않습니다.');
    }
    
    // API에서 반환한 이미지 URL
    const apiImageUrl = response.data.imageUrl;
    logger.info(`[패치노트] API에서 반환한 이미지 URL: ${apiImageUrl}`);
    
    // 1. 이미지 다운로드
    const imageResponse = await axios.get(rankUrl + apiImageUrl, { 
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    // 2. 이미지 처리 - 고유 파일명 생성
    const imageBuffer = Buffer.from(imageResponse.data);
    const uniqueId = Date.now() + '_' + Math.floor(Math.random() * 10000);
    const fileName = `table_${uniqueId}.png`;
    
    // 3. 이미지를 images/patch_note 폴더에 저장
    const imagesDir = path.join(__dirname, '../images/patch_note');
    if (!fs.existsSync(imagesDir)) {
      logger.info(`[패치노트] patch_note 디렉토리 생성: ${imagesDir}`);
      fs.mkdirSync(imagesDir, { recursive: true });
    }
    
    const filePath = path.join(imagesDir, fileName);
    fs.writeFileSync(filePath, imageBuffer);
    logger.info(`[패치노트] 테이블 이미지 저장 성공: ${filePath}`);
    
    // 4. 외부 접근용 URL 생성
    const publicImageUrl = `http://${process.env.SERVER_IP}:${process.env.WEB_PORT}/images/patch_note/${fileName}`;
    logger.info(`[패치노트] 테이블 이미지 생성 성공: ${publicImageUrl}`);
    
    return publicImageUrl;
  } catch (error) {
    logger.error(`[패치노트] 테이블 이미지 변환 오류: ${error.message}`);
    
    // 오류 발생 시 puppeteer 백업 방식으로 전환
    try {
      logger.info(`[패치노트] 백업 방식으로 테이블 변환 시도`);
      return await puppeteerBackupMethod(html);
    } catch (backupError) {
      logger.error(`[패치노트] 백업 방식 실패: ${backupError.message}`);
      return null;
    }
  }
}

// puppeteer를 사용한 백업 방식
async function puppeteerBackupMethod(html) {
  // HTML 구조 전처리 - 빈 테이블 셀 처리 및 테이블 구조 보정
  const processedHtml = html.replace(/<td[^>]*>\s*<\/td>/g, '<td>&nbsp;</td>');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // 기본 스타일이 적용된 HTML 템플릿 설정
  const htmlTemplate = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap" rel="stylesheet">
    <style>
      body { font-family: 'Noto Sans KR', Arial, sans-serif; background-color: white; padding: 20px; }
      table { border-collapse: collapse; width: 100%; max-width: 800px; margin: 0 auto; table-layout: fixed; }
      table, td, th { border: 1px solid #ddd; }
      td, th { padding: 8px; text-align: center; word-break: break-word; }
      th { background-color: #333; color: white; }
      tr:nth-child(even) { background-color: #f2f2f2; }
      td:empty { padding: 8px; }
    </style>
  </head>
  <body>
    ${processedHtml}
  </body>
  </html>
  `;
  
  await page.setContent(htmlTemplate);
  
  // 테이블 이미지 캡처
  const element = await page.$('table');
  const imageBuffer = await element.screenshot({ 
    type: 'png',
    omitBackground: true
  });
  
  await browser.close();
  
  try {
    // 이미지 저장 및 URL 생성
    const imagesDir = path.join(__dirname, '../images/patch_note');
    if (!fs.existsSync(imagesDir)) {
      logger.info(`[패치노트] patch_note 디렉토리 생성: ${imagesDir}`);
      fs.mkdirSync(imagesDir, { recursive: true });
    }
    
    const uniqueId = Date.now() + '_' + Math.floor(Math.random()*10000);
    const fileName = `table_${uniqueId}.png`;
    const filePath = path.join(imagesDir, fileName);
  
    // 버퍼 저장
    fs.writeFileSync(filePath, imageBuffer);
    logger.info(`[패치노트] 테이블 이미지 저장 성공 (백업 방식): ${filePath}`);
    
    // 공개 URL 생성
    const imageUrl = `http://${process.env.SERVER_IP}:${process.env.WEB_PORT}/images/patch_note/${fileName}`;
    return imageUrl;
  } catch (error) {
    logger.error(`[패치노트] 백업 방식 테이블 이미지 저장 오류: ${error.message}`);
    return null;
  }
}

// 테스트용 간단한 임베드 전송 함수

// 테스트용 간단한 임베드 전송 함수
async function sendSimpleEmbedMessage(client) {
try {
  // 채널 ID 가져오기
  const channelId = await getChannelId();
  if (!channelId) {
    throw new Error('패치 노트를 게시할 채널 ID를 찾을 수 없습니다.');
  }
  
  // 채널 가져오기
  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    throw new Error(`채널을 찾을 수 없습니다. (ID: ${channelId})`);
  }
  
  // 채널 타입 확인
  logger.info(`[패치노트 테스트] 채널 타입: ${channel.type}, 이름: ${channel.name}`);
  
  // 데이터 가져오기
  const patchData = await getLatestPatchData();
  if (!patchData) {
    throw new Error('패치 노트 데이터를 가져올 수 없습니다.');
  }
  
  const title = patchData.title;
  const post_date = patchData.post_date;
  // contents_json 에서 URL 추출
  const url = patchData.contents_json.url || '';
  
  logger.info(`[패치노트 테스트] 제목: ${title}, 날짜: ${post_date}`);
  
  if (channel.type === 15) { // 포럼 채널
    logger.info(`[패치노트 테스트] 포럼 채널에 스레드 생성`);
    
    // 포럼 스레드 생성
    const thread = await channel.threads.create({
      name: title || `패치노트 테스트 ${new Date().toLocaleString('ko-KR')}`,
      autoArchiveDuration: 4320,
      reason: '패치노트 테스트',
      message: {
        content: `${title}`
      }
    });
    
    logger.info(`[패치노트 테스트] 스레드 생성 완료 (ID: ${thread.id})`);
    
    // 테스트 메시지 전송 (2개만 전송)
    for(let i = 0; i < 2; i++) {
      let part = i + 1;
      const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**패치노트 부분 ${part}**`)
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
      )
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems({
          media: { url: 'https://dszw1qtcnsa5e.cloudfront.net/community/20250514/347478f4-e522-42bb-83ed-57587ed0ccaa/Property1%EC%97%85%EB%8D%B0%EC%9D%B4%ED%8A%B8%EB%85%B8%ED%8A%B8.png', type: 4 }
        })
      );

      await thread.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      
      // API 제한 방지를 위한 딩레이
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return thread.id;
  } 
} catch (error) {
  logger.error(`[패치노트 테스트] 오류 발생: ${error.message}`);
  logger.error(error.stack);
  throw error;
}
}

module.exports = {
sendDiscordMessage,
getLatestPatchData,
sendSimpleEmbedMessage  // 테스트 함수 추가
};