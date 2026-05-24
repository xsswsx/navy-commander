# 海军指挥官 (Navy Commander)

基于 Vue 3 的海军桌游数字化实现。玩家设计战舰、指挥军备、与对手展开回合制海战。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Element Plus |
| 游戏逻辑 | 纯 TypeScript (骰子、卡组、军备效果引擎) |
| 多人联机 | Socket.IO + Node.js 服务端 |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器 (热座 / 单机)
npm run dev

# 启动多人联机服务端
npm run dev:server

# 生产构建
npm run build
```

开发模式下，客户端运行在 `localhost:5173`，服务端运行在 `localhost:3001`。Vite 代理自动将 `/socket.io` 请求转发到服务端。

## 游戏模式

| 模式 | 状态 | 说明 |
|------|------|------|
| 热座模式 | 可用 | 本地多人轮流，同设备 pass-and-play |
| 多人模式 | 可用 | 在线联机，Socket.IO 实时同步 |
| 单机模式 | 开发中 | vs AI 对战 |

## 项目结构

```
navy_commander/
├── server/                   # 多人联机服务端
│   ├── index.ts              # Socket.IO 入口
│   └── state.ts              # 服务端状态管理
├── shared/
│   └── protocol.ts           # 前后端共享协议
├── src/
│   ├── game/                 # 纯游戏逻辑 (无 Vue 依赖)
│   │   ├── types.ts          # 类型定义
│   │   ├── constants.ts      # 常量
│   │   ├── dice.ts           # 骰子系统
│   │   ├── deck.ts           # 卡组建构
│   │   └── equipment/        # 军备注册表 (18种)
│   ├── stores/               # Pinia 状态管理
│   │   ├── game.ts           # 游戏阶段/回合
│   │   ├── ship.ts           # 舰船/舱段
│   │   ├── card.ts           # 卡组/手牌
│   │   ├── combat.ts         # 战斗效果/鱼雷/空优
│   │   └── ui.ts             # UI 状态机
│   ├── views/
│   │   ├── SetupView.vue     # 游戏设置
│   │   ├── DesignView.vue    # 舰船设计
│   │   ├── BattleView.vue    # 战斗主界面
│   │   └── ResultsView.vue   # 结算画面
│   ├── components/
│   │   ├── battle/           # 战斗组件 (GameBoard, PlayerHand, ActionBar...)
│   │   ├── design/           # 设计组件
│   │   ├── setup/            # 设置组件 (含 MultiplayerLobby)
│   │   └── common/           # 通用组件
│   ├── modes/                # 游戏模式适配器
│   │   ├── hotseat/          # 热座模式
│   │   ├── single/           # 单机模式 (开发中)
│   │   └── multiplayer/      # 多人模式
│   └── router/               # Vue Router
└── 海军指挥官.md              # 桌游规则书
```

## 游戏规则

详见 [海军指挥官.md](./海军指挥官.md) 完整规则书。

核心机制:
- **舰船设计**: 设定舱段数，安装 18 种军备 (战斗/支援/资源)
- **卡组系统**: 116 张共享牌 (移动 40 / 指挥 40 / 行动 20 / 咖啡 8 / 谋划 8)
- **回合流程**: 抽牌 → 行动 (打牌 + 1 自由行动) → 弃牌
- **战斗结算**: D8 命中判定 → D6/D12 伤害, 空优系统, 鱼雷延迟伤害, 殉爆连锁
- **胜利条件**: 击沉所有敌方舰船

## License

MIT
