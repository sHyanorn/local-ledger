# local-ledger 项目规格

## 1. 一句话介绍

一个数据只存在本机、整库加密的个人记账桌面应用：导入银行 CSV，自动分类，设置预算，查看月度图表，导出 Excel 和 PDF。

## 2. 要证明的能力

| 能力 | 体现在哪里 |
|---|---|
| 桌面端开发 | Electron 多进程架构、IPC、原生菜单、打包签名、自动更新 |
| 安全 | 整库加密、密钥派生、Electron 安全加固、自动锁定 |
| 前端与审美 | React + Zustand、苹果风界面、深色模式、流畅交互 |
| 数据处理 | CSV 解析与列映射、去重、规则分类、导出 |

## 3. 功能范围

### 必做

- 首次启动设置主密码；之后每次启动需解锁
- 账户管理：多个银行账户或现金账户
- CSV 导入
  - 内置澳洲常见银行格式模板（CommBank、NAB、ANZ、Westpac），以及通用列映射向导
  - 日期和金额格式识别，导入前预览
  - 重复交易检测（日期、金额、描述的模糊匹配）
- 自动分类
  - 用户规则：描述包含某关键词就归入某类
  - 用户手动修改分类后，提示是否生成新规则
- 预算：按分类设置月度预算，超支提醒
- 图表：月度收支、分类占比、趋势
- 搜索与筛选
- 导出：Excel 和 PDF 月度报告
- 空闲自动锁定
- 加密备份与恢复
- 深色模式

### 选做

- 多币种（AUD、CNY），汇率手动输入
- 本地机器学习分类（朴素贝叶斯，完全离线）
- 自动更新（GitHub Releases）

### 不做

- 云同步
- 连接银行接口

## 4. 架构

```
┌───────────── 渲染进程 (sandbox) ─────────────┐
│ React + Zustand                              │
│ window.ledger.* (preload 暴露的类型化接口)     │
└───────────────────┬──────────────────────────┘
                    │ IPC（zod 校验）
┌───────────────────▼──────────────────────────┐
│ 主进程                                         │
│  vault：主密码 → Argon2id → 数据库密钥          │
│  db：SQLCipher 兼容的加密 SQLite               │
│  import / export / rules / backup            │
└──────────────────────────────────────────────┘
```

加密方案：

- 数据库使用 `better-sqlite3-multiple-ciphers`（兼容 SQLCipher）整库加密
- 主密码加随机盐，经 Argon2id 派生数据库密钥；盐和参数存在单独的明文配置文件
- 修改主密码时重新加密数据库
- 备份文件本身就是加密数据库加版本信息

## 5. 数据模型

```
accounts(id, name, type, currency, created_at)
transactions(id, account_id, date, amount_cents, description, category_id,
             import_batch_id, hash, notes, created_at)
categories(id, name, parent_id, color, icon)
rules(id, pattern, match_type, category_id, priority)
budgets(id, category_id, month, amount_cents)
import_batches(id, file_name, row_count, imported_at)
```

金额统一用整数（分）存储。

## 6. 界面

- 侧边栏：总览、交易、预算、报告、设置
- 总览：本月收支卡片、预算进度、最近交易
- 风格：参考 macOS 原生应用，系统字体、半透明侧边栏、细腻动效、键盘快捷键
- 演示截图全部使用假数据

## 7. 测试策略

- 单元测试：CSV 解析（各银行样例）、去重、规则匹配、金额计算
- 安全测试：确认渲染进程无法访问 `require`、`process`；错误的 IPC 参数被拒绝；锁定后数据不可读
- 加密测试：数据库文件用普通 SQLite 打不开；错误密码无法解锁
- 端到端测试：设置密码、导入、分类、预算、导出完整流程

## 8. 交付物

- macOS 和 Windows 安装包（GitHub Releases）
- 英文 README：截图、GIF、安全设计说明、下载链接
- `docs/SECURITY_DESIGN.md`：Electron 加固清单和加密方案
