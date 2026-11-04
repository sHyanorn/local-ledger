# CLAUDE.md

本仓库是 Aaron 的作品集项目：一个数据只存本地、整库加密的个人记账桌面应用。展示重点是 Electron 安全实践、加密存储、打包交付和苹果风界面。

## 开工前必读

1. `docs/SPEC.md`
2. `docs/TASKS.md`：从第一个未勾选的里程碑开始
3. `docs/DECISIONS.md`

## 目录结构

```
src/
  main/       Electron 主进程：窗口、数据库、加密、文件导入导出
  preload/    预加载脚本：只暴露类型化的白名单接口
  renderer/   React + TypeScript + Zustand 界面
  shared/     主进程和渲染进程共用的类型与校验 schema
tests/
  unit/       Vitest
  e2e/        Playwright for Electron
```

## 工作方式

- 每个里程碑先出计划，等 Aaron 确认
- 一个任务一次提交，Conventional Commits 英文格式
- 完成后打勾，新决定写入 DECISIONS.md

## 常用命令

```bash
npm run dev
npm test
npm run test:e2e
npm run lint && npm run typecheck
npm run build        # 生成安装包
npm run seed         # 生成演示用假数据
```

## Electron 安全硬性规则

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- 渲染进程禁止直接访问 Node 和数据库；只通过 preload 暴露的有限接口通信
- 每个 IPC 通道的参数在主进程用 zod 校验
- 严格 CSP，禁止加载任何远程内容；禁止 `eval`；拦截新窗口和外部导航
- 主密码只在内存中短暂存在，派生出密钥后立即丢弃；日志中禁止出现密码、密钥和交易明细
- 空闲超时自动锁定，锁定时清空内存中的密钥和解密数据
- 测试和截图只用 `npm run seed` 生成的假数据
- 依赖固定版本，新增依赖说明理由
