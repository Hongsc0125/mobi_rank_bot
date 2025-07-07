const { DataTypes } = require('sequelize');
const { sequelize } = require('../session');

const RankRequest = sequelize.define('RankRequest', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  searchKey: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'search_key'
  },
  userKey: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    field: 'user_key'
  },
  userId: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'user_id'
  },
  channelId: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'channel_id'
  },
  guildId: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'guild_id'
  },
  serverName: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'server_name'
  },
  characterName: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'character_name'
  },
  loadingMessageId: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'loading_message_id'
  },
  status: {
    type: DataTypes.ENUM('waiting', 'processing', 'completed', 'failed'),
    defaultValue: 'waiting',
    allowNull: false
  },
  jobId: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'job_id'
  }
}, {
  tableName: 'rank_requests',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['search_key']
    },
    {
      fields: ['user_key']
    },
    {
      fields: ['status']
    },
    {
      fields: ['created_at']
    }
  ]
});

// 클래스 메서드들
RankRequest.findBySearchKey = async function(searchKey) {
  return await this.findAll({
    where: { searchKey, status: ['waiting', 'processing'] },
    order: [['created_at', 'ASC']]
  });
};

RankRequest.findByUserKey = async function(userKey) {
  return await this.findOne({
    where: { userKey, status: ['waiting', 'processing'] }
  });
};

RankRequest.cleanupOldRequests = async function() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
  
  // 1분 이상 된 진행중인 요청들을 실패 처리
  await this.update(
    { status: 'failed' },
    { 
      where: { 
        status: ['waiting', 'processing'],
        created_at: { [require('sequelize').Op.lt]: oneMinuteAgo }
      }
    }
  );
  
  // 1시간 이상 된 모든 요청 삭제
  return await this.destroy({
    where: {
      created_at: { [require('sequelize').Op.lt]: oneHourAgo }
    }
  });
};

RankRequest.completeRequests = async function(searchKey, status = 'completed') {
  return await this.update(
    { status },
    {
      where: { searchKey, status: ['waiting', 'processing'] }
    }
  );
};

module.exports = RankRequest;