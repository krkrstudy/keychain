# 钥匙串同步后台

为 https://krkrstudy.github.io/keychain/ 提供加密密码库同步及独立管理员密码验证。浏览器不需要 GitHub 令牌。

- `GET /vault`：公开读取密文与版本号，明文解密只在浏览器进行。
- `POST /admin/login`：验证管理员密码，返回短期会话。每个地址 15 分钟最多 10 次失败尝试。
- `PUT /vault`：要求有效管理员会话，并检查版本号；拒绝未授权请求和并发覆盖。
- `POST /admin/logout`：撤销会话。会话最长有效 1 小时。

数据存储：Sites 的 D1；`vault` 保存密文，`admin_sessions` 仅保存会话摘要，`login_attempts` 保存地址摘要与限流计数。

运行配置通过 Sites 的环境设置提供，严禁写入源码：

- `ADMIN_AUTH`：管理员密码的随机盐和 PBKDF2-SHA-256 校验值。初始管理密码是 144 位随机值，校验使用 100,000 次迭代。
- `INITIAL_VAULT`：从旧站迁移的加密密码库。仅在数据库尚无记录时作为初始值使用。

管理员密码与查看密码独立。服务器不会获得业务密码的解密密钥。浏览器将管理密码通过 HTTPS 发给后台验证。会话只在页面内存中保存，锁定时发起撤销请求；网络中断时以服务端到期时间为准。

固定允许来源为 `https://krkrstudy.github.io`；CORS 只控制浏览器访问，写入授权始终在服务端验证。前端没有任何可直接修改数据库的长期密钥。

本地检查：Node.js 24 执行 `node --test tests/*.test.mjs`。使用 Drizzle 生成数据库迁移；已应用的迁移不可修改。`node build.mjs` 生成 Cloudflare Worker 输出，使用 Sites 部署。
