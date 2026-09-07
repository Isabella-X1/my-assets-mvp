# 我的资产 PWA

一个面向手机使用的私人资产记录工具。正式版前端由 Netlify 托管，账户与资产数据保存在 Supabase PostgreSQL 中。

> 项目需求、8 步实施计划、真实验收状态和下次续接位置，以 [需求与实施进度文档](docs/PROJECT_REQUIREMENTS_AND_PROGRESS.md) 为准。第 1～7 步均已由用户确认；第 8 步最终审计、GitHub 同步、Netlify 自动部署和 Supabase 正式回调配置已完成，只剩手机终验。

正式网址：[https://isabella-my-assets.netlify.app](https://isabella-my-assets.netlify.app)

## 当前代码包含（不等于逐步验收完成）

- 邀请制邮箱账号登录和密码找回
- 账户及资产的新增、编辑、删除
- 总资产、累计收益、分类占比和账户小计实时计算
- 到期日和提前提醒列表
- 手机、电脑跨设备读取同一份云端数据
- CSV 和 JSON 备份导出
- 可安装 PWA、离线提示和版本缓存
- Supabase RLS 用户数据隔离

## 本地运行

1. 复制 `.env.example` 为 `.env`。
2. 填入 Supabase Project URL 和 publishable/anon key。
3. 安装依赖并启动：

```bash
npm install
npm run dev
```

仅预览界面而不连接数据库时，可以临时使用：

```bash
VITE_DEMO_MODE=true npm run dev
```

预览模式只在本地开发环境生效，数据不会保存，也不会进入生产构建。

## Supabase

数据库迁移和安全配置说明见 `supabase/README.md`。先执行 `supabase/migrations/20260811000100_initial_schema.sql`，再创建首位用户并关闭公开注册。

前端只能配置以下公开变量：

```dotenv
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

旧项目的 `VITE_SUPABASE_ANON_KEY` 仍兼容。严禁提交数据库密码、JWT secret、secret key 或 `service_role` key。

首个用户请由管理员在 Supabase Dashboard 的 **Authentication → Users → Add user → Create new user** 中创建并自动确认。仓库的 `supabase/config.toml` 已关闭公开注册；不要在创建首个用户之前把该配置推送到一个全新的项目。

## 验证

```bash
npm run check
npm test
npm run build
```

## Netlify

仓库已经包含 `netlify.toml`。Netlify 站点 `isabella-my-assets` 已连接 GitHub `main` 分支；站点环境变量包含 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`，每次推送后会运行 `npm run build` 并发布 `dist`。

正式域名已加入 Supabase Authentication 的 Site URL 和 Redirect URLs。
