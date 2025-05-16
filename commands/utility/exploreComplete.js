const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');

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
        // 시:분만 추출
        const nextHour = String(nextTime.getHours()).padStart(2, '0');
        const nextMin = String(nextTime.getMinutes()).padStart(2, '0');
        const nextTimeStr = `${nextHour}:${nextMin}`;

        // 안내문(컴포넌트 V2)
        const userName = interaction.user?.displayName || interaction.user?.username || '유저';
        
        const header = `## \`${userName}\`님이 \`${map}\` 탐색을 완료했습니다.`;
        const desc = `> \`${map}\`의 심층구멍 탐색이 완료되었습니다.\n> 다음 구멍 생성 예상 시간: \`${nextTimeStr}\`\n> (남은시간 약 \`${remainMin}분\`)`;
        const footer = `# ⚠️ \`${nextTimeStr}\` 이전에는 심층구멍이 없는걸 확인했습니다.`;
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(header)
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
            flags: MessageFlags.IsComponentsV2
        });
    }
};
