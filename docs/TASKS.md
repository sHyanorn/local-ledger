# 任务清单

## M0 初始化
- [ ] 用 electron-vite 创建 React + TypeScript 项目，加入 Zustand
- [ ] 配置 ESLint、Prettier、Vitest、Playwright
- [ ] 按 CLAUDE.md 完成 Electron 安全配置，写安全配置测试
- [ ] CI：lint、类型检查、单元测试

## M1 加密存储
- [ ] Argon2id 密钥派生与参数配置
- [ ] 加密数据库打开、建表、迁移
- [ ] 首次设置密码与解锁界面
- [ ] 空闲自动锁定
- [ ] 修改主密码
- [ ] 加密测试

## M2 数据核心
- [ ] 类型化 IPC 接口与 zod 校验
- [ ] 账户和分类增删改查
- [ ] 交易列表、搜索、筛选、编辑
- [ ] `npm run seed` 假数据生成器

## M3 导入与分类
- [ ] CSV 解析与通用列映射向导
- [ ] 四家澳洲银行模板（用自造的样例文件测试）
- [ ] 导入预览与重复检测
- [ ] 规则引擎与"修改后生成规则"提示

## M4 预算与报告
- [ ] 预算设置与超支提醒
- [ ] 总览和报告图表
- [ ] Excel 和 PDF 导出

## M5 打磨与交付
- [ ] 苹果风界面打磨、深色模式、快捷键
- [ ] 加密备份与恢复
- [ ] electron-builder 打包 macOS 和 Windows
- [ ] Playwright 端到端测试
- [ ] 写 `docs/SECURITY_DESIGN.md`
- [ ] 英文 README、截图、GIF，发布第一个 Release
