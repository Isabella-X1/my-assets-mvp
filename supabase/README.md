# Supabase 设置与验证

该目录包含资产管理 PWA 的数据库初始迁移。真实资产数据存放在 Supabase PostgreSQL 中；Netlify 只托管前端文件。

## 1. 创建并配置项目

1. 在 Supabase 创建项目，妥善保存数据库密码。
2. 在 **Authentication → URL Configuration** 中设置正式站点 URL，并加入本地开发和 Netlify 预览所需的 Redirect URL。
3. 在 **Authentication → Providers → Email** 中启用邮箱登录。个人首版建议先创建自己的账号，再关闭公开注册；不要用前端代码实现邮箱白名单。
4. 记录项目的 `Project URL` 和 publishable key。前端只使用这两个公开配置；**绝不能**把 secret/`service_role` key、数据库密码或 JWT secret 放进网页、GitHub 或 Netlify 构建产物。

## 2. 应用迁移

推荐使用 Supabase CLI。仓库已包含 `supabase/config.toml`，把项目连接到目标 Supabase 项目后执行：

```bash
supabase link --project-ref <project-ref>
supabase db push
```

CLI 会记录迁移历史，后续数据库修改也应继续通过新的 migration 执行，不要直接改远端表结构。

首次暂时无法使用 CLI 时，也可以在 Supabase Dashboard 的 SQL Editor 中完整执行：

```text
migrations/20260811000100_initial_schema.sql
```

若使用 SQL Editor 手动执行，随后必须让 CLI 的迁移历史与实际结构保持一致，再运行后续 `db push`：

```bash
supabase link --project-ref <project-ref>
supabase migration repair 20260811000100 --status applied
supabase migration list
```

同一个项目只能选择一种首次应用方式，**不要先手动执行 SQL，又直接让 `db push` 重跑同一迁移**。

迁移会创建：

- `profiles`：Auth 用户对应的个人资料；注册时由数据库触发器自动建立。
- `accounts`：账户容器，只允许保存末四位，不保存完整卡号。
- `assets`：本金、当前价值、年化收益率、日期和提醒设置。
- `asset_snapshots`：历史资产价值记录；新增资产或修改本金、当前金额时由数据库自动记录。

所有业务表都启用了 RLS。登录用户只可对自己的行执行查询、新增、修改和删除。资产与账户、快照与资产都使用“记录 ID + owner ID”复合外键，不能把自己的记录关联到其他用户的数据。

账户仍有资产时，删除账户会被数据库拒绝；应先转移、归档或删除其资产。删除资产会一并删除该资产的历史快照。

## 3. 前端环境变量

本地 `.env` 和 Netlify 环境变量使用：

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

旧项目可继续使用 `VITE_SUPABASE_ANON_KEY`。Project URL 与 publishable key 会出现在浏览器中，这是 Supabase 的正常用法；安全边界是用户 JWT 加数据库 RLS。前端新增 `accounts`、`assets` 或 `asset_snapshots` 时可以省略 `owner_id`，数据库会用当前 JWT 的 `auth.uid()` 填充；也可显式传入当前用户 ID，RLS 会再次校验。

`annual_rate` 使用百分比数值，例如 `3.05` 表示 `3.05%`，不是 `0.0305`，允许范围为 0–10000。金额字段为 `numeric(20,2)`，范围为 0–1 万亿元；`reminder_days` 范围为 0–365。快照的 `recorded_on` 按 `Asia/Shanghai` 日历日期记录，`created_at` 仍保留精确时刻。

## 4. 数据库检查

迁移完成后，在 SQL Editor 运行以下只读查询：

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'accounts', 'assets', 'asset_snapshots')
order by tablename;

select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'accounts', 'assets', 'asset_snapshots')
order by tablename, cmd, policyname;

select event_object_schema, event_object_table, trigger_name
from information_schema.triggers
where trigger_name in (
  'on_auth_user_created',
  'profiles_set_updated_at',
  'accounts_set_updated_at',
  'assets_set_updated_at',
  'asset_snapshots_set_updated_at',
  'assets_capture_initial_snapshot',
  'assets_capture_changed_snapshot'
)
order by event_object_schema, event_object_table, trigger_name;
```

预期结果：四张表的 `rowsecurity` 都为 `true`；每张表有 SELECT、INSERT、UPDATE、DELETE 四条仅授予 `authenticated` 的策略；七个触发器均存在。

## 5. 隔离验收

至少用两个测试账号通过应用完成一次验证：

1. 账号 A 创建账户和资产，修改一次金额，并确认数据库自动生成了对应快照；刷新后数据仍存在。
2. 账号 B 登录后看不到账号 A 的任何记录。
3. 账号 B 即使猜到 A 的 UUID，也无法读取、修改、删除或关联 A 的记录。
4. 修改一条记录后，`updated_at` 自动变化。
5. 有资产的账户不能直接删除；删除资产后，其快照被级联删除。
6. 删除测试 Auth 用户时，其账户、资产和快照均能一并清理，不会被账户外键阻断。

SQL Editor 默认使用管理员上下文，会绕过 RLS，因此不能用管理员查询结果替代真实登录用户的隔离测试。
