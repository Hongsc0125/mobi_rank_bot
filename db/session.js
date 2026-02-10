// 데이터베이스 세션 관리
const { Sequelize } = require('sequelize');
const settings = require('../core/config');
const winston = require('winston');

// 로깅 설정
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// 기본 데이터베이스 엔진
const sequelize = new Sequelize(settings.DATABASE_URL, {
  dialect: 'postgres',
  logging: msg => logger.debug(msg),
  dialectOptions: {
    ssl: false
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// 랭크 데이터베이스 엔진
const rankSequelize = new Sequelize(settings.RANK_DATA_URL, {
  dialect: 'postgres',
  logging: msg => logger.debug(msg),
  dialectOptions: {
    ssl: false
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// kadan 데이터베이스 엔진
const kadanSequelize = new Sequelize(settings.KADAN_DB_URL, {
  dialect: 'postgres',
  logging: msg => logger.debug(msg),
  dialectOptions: {
    ssl: false
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// 세션 팩토리 생성
const sessionmaker = (options) => {
  return sequelize;
};

// 데이터베이스 연결 테스트
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    logger.info('기본 데이터베이스 연결 성공');
    
    await rankSequelize.authenticate();
    logger.info('랭크 데이터베이스 연결 성공');
    
    await kadanSequelize.authenticate();
    logger.info('kadan 데이터베이스 연결 성공');
    
    return true;
  } catch (error) {
    logger.error(`데이터베이스 연결 실패: ${error.message}`);
    return false;
  }
};

module.exports = {
  sequelize,
  rankSequelize: rankSequelize,
  kadanSequelize: kadanSequelize,
  sessionmaker,
  testConnection,
  logger
};
