const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('탐색완료')
        .setDescription('심층구멍 탐색이 끝났음을 알리고 다음 생성예상시간을 안내합니다.')
        .addStringOption(option =>
            option.setName('맵')
                .setDescription('맵을 선택하세요')
                .setRequired(true)
                .addChoices(
                    { name: '여신의뜰', value: '여신의뜰' },
                    { name: '얼음협곡', value: '얼음협곡' }
                )
        )
        .addIntegerOption(option =>
            option.setName('남은시간')
                .setDescription('남은 시간(분) 입력')
                .setRequired(true)
        ),

    async execute(interaction) {
        const map = interaction.options.getString('맵');
        const remainMin = interaction.options.getInteger('남은시간');
        if (remainMin <= 0) {
            await interaction.reply({ content: '남은 시간은 1분 이상이어야 합니다.', ephemeral: true });
            return;
        }
        // 다음 생성 예상 시간 계산
        const now = new Date();
        const nextTime = new Date(now.getTime() + remainMin * 60000);
        const nextTimeStr = nextTime.toLocaleString('ko-KR', { hour12: false });

        // 안내문(컴포넌트 V2)
        const header = `## 심층구멍 탐색 완료 안내`;
        const desc = `> **${map}**의 심층구멍 탐색이 완료되었습니다.\n> 다음 구멍 생성 예상 시간: **${nextTimeStr}**\n> (남은 ${remainMin}분)`;
        const footer = `## ⚠️ 안내사항\n> • ${nextTimeStr} 이전에는 심층구멍이 없습니다.\n> • 시간 전까지는 제보를 삼가주세요.`;
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(header)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(desc)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(footer)
            );
        await interaction.reply({
            components: [container],
            flags: 1 << 23 // MessageFlags.IsComponentsV2
        });
    }
};
