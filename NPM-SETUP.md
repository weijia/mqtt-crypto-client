# npm 发布设置（Trusted Publishing / OIDC）

本文只描述**需要你在 npmjs 上完成的一次性设置**。本地工作区、CI 配置与 GitHub 公开仓库均已就绪，未执行 `npm publish`。

- 包名：`mqtt-crypto-client`
- npm 包页面（首次发布后生成）：<https://www.npmjs.com/package/mqtt-crypto-client>
- GitHub 仓库：<https://github.com/weijia/mqtt-crypto-client>（public，`main` 已推送）

- 发布工作流：`.github/workflows/publish.yml`（文件名 `publish.yml`）
- 触发方式：推送 `v*` tag，或发布 GitHub Release

## 1. 包名占用检查（已执行）

```bash
npm view mqtt-crypto-client version
```

执行结果（2026-11-03）：`E404 Not Found ... 'mqtt-crypto-client@*' is not in this registry`，即当前 **未被占用**。npm 名称先到先得，正式发布前建议再执行一次确认。

## 2. 首次发布前必须知道的前提

npm 的 Trusted Publisher 配置入口位于**包的 Settings 页面**，而该页面只有在包已经存在于 registry 后才存在。因此 OIDC 无法完成「从未发布过的包」的第一次发布。可选做法：

1. **推荐**：本地手动完成 0.1.0 的首次发布（仅这一次使用登录态/2FA，不产生长期 token）：

   ```bash
   npm login
   npm ci
   npm test
   npm run typecheck
   npm run build
   npm publish --access public
   ```

   随后立即在 npmjs 上配置 Trusted Publisher（见第 3 节），之后所有版本都由 CI 通过 OIDC 发布。

2. 或者用**临时 granular access token** 在 CI 里完成首次发布，然后删除该 token，再切换到 OIDC。

> 如果你不希望在本地发布，也可以先在 npmjs 上创建一个同名占位包（例如发布一个极简 0.0.0），再配置 OIDC；但第一次发布的版本号会占用 registry 历史。

## 3. npmjs 上需要填写的 Trusted Publisher

路径：**npmjs.com → 你的包 `mqtt-crypto-client` → Settings → Trusted publishing → GitHub Actions**

| 字段 | 填写值 |
| --- | --- |
| Organization or user | `weijia` |
| Repository | `mqtt-crypto-client` |
| Workflow filename | `publish.yml`（只填文件名，不要带 `.github/workflows/` 路径） |
| Environment name | **留空**（本仓库工作流没有配置 GitHub Environment） |
| Allowed actions | 勾选 **`npm publish`**（如需改 dist-tag 再勾 `npm dist-tag`） |

注意：npm 自 2026-03-09 起，新建的 trusted publisher 默认只允许 `npm stage publish`。本工作流使用 `npm publish`，所以必须显式勾选 `npm publish`，否则 CI 会认证成功但被拒绝直接发布。

### Provenance

- npmjs 侧**没有单独的 provenance 开关**；provenance 由发布命令与 CI 环境决定。
- 本仓库已配置：工作流 `permissions: id-token: write`，发布命令 `npm publish --provenance --access public`，`package.json` 中 `publishConfig.provenance: true`。
- 生成 provenance 需要：公开 GitHub 仓库 + GitHub 托管的 Actions runner（自托管 runner 不支持）。本仓库为公开仓库，满足条件。
- 发布成功后，npm 包页面会出现 provenance 标识，可用 `npm view mqtt-crypto-client@<version> dist.attestations` 检查。

### 发布访问策略（建议）

在同一 Settings 页面把 **Publishing access** 设为：

- **Require two-factor authentication and disallow tokens**（要求 2FA、禁止长期 token）

这样只保留 OIDC 发布路径。设置前请确认 Trusted Publisher 已生效，避免把自己锁死。

## 4. CI 工作流行为

`.github/workflows/publish.yml`：

```yaml
on:
  push:
    tags: ['v*']
  release:
    types: [published]

permissions:
  id-token: write   # OIDC
  contents: read
```

步骤：checkout → setup-node 24 → 升级 npm 到 `>=11.5.1`（Trusted Publishing 的最低要求，Node 22.14+）→ `npm ci` → `npm test` → `npm run typecheck` → `npm run build` → `npm publish --provenance --access public`。

工作流**不读取 `NPM_TOKEN`**，也没有设置 `NODE_AUTH_TOKEN`。

发布一个新版本：

```bash
npm version patch        # 或 minor / major
git push origin main
git push origin v0.1.1   # 触发 CI
```

> 同一个版本不要同时通过 tag 和 Release 触发两次；第二次会因版本已存在而失败。

## 5. 如果你的 CI 不是 GitHub Actions（如 Gitea）

npm Trusted Publishing 目前只支持：GitHub Actions（GitHub 托管 runner）、GitLab.com 共享 runner、CircleCI。Gitea / Jenkins / 自建 runner **不能使用 OIDC 直连 npmjs**。替代方案：

1. 在 npmjs → Access Tokens 创建 **Granular Automation Token**（仅限该包、仅 publish 权限）。
2. 存入 Gitea 仓库 Secret（例如 `NPM_TOKEN`）。
3. CI 中写入临时 `.npmrc`（不要提交到仓库）：

   ```bash
   echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc
   npm ci && npm test && npm run build
   npm publish --access public
   ```

4. `--provenance` 在不受支持的 CI 上不可用，请去掉该参数与 `publishConfig.provenance`，否则发布会失败。

代价是重新引入长期 token，需要定期轮换并限制权限。

## 6. 发布后核对

```bash
npm view mqtt-crypto-client version
npm view mqtt-crypto-client dist.tarball
npm view mqtt-crypto-client dist.attestations
npm view mqtt-crypto-client repository.url
```

同时确认包页面显示 GitHub 仓库与 provenance 徽标。

## 7. 仍需你确认/替换的信息

- 包名 `mqtt-crypto-client` 是否最终采用（当前未被占用）。
- 仓库地址已使用真实地址 `https://github.com/weijia/mqtt-crypto-client`；若迁移仓库，需要同步更新 `package.json` 的 `repository/bugs/homepage` 与 npm Trusted Publisher 的 org/repo。
- `LICENSE` 的版权主体当前写为 `weijia`，如有正式主体请替换。
- 首次发布必须由你手动执行或在 npmjs 上完成一次 token 发布（见第 2 节），之后 OIDC 链路即可全自动。
